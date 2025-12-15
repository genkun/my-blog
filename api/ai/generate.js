// /api/ai/generate.js
export const config = { runtime: 'nodejs' };

import fs from 'fs';
import path from 'path';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let body;
  try {
    if (res && typeof res.json === 'function') {
      body = await res.json();
    } else {
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = text; }
    }
  } catch (e) {
    try { const text = await res.text(); body = JSON.parse(text); } catch { body = text || null; }
  }
  return { ok: res.ok, status: res.status, body };
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function getDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function readRepoInfo() {
  try {
    const cfgPath = path.resolve(process.cwd(), 'public', 'admin', 'config.yml');
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const repoMatch = txt.match(/^\s*repo:\s*(?<repo>\S+)/m);
    const branchMatch = txt.match(/^\s*branch:\s*(?<branch>\S+)/m);
    const publishMatch = txt.match(/^\s*publish_mode:\s*(?<mode>\S+)/m);
    if (!repoMatch) throw new Error('repo not found in ' + cfgPath);
    const repo = repoMatch.groups.repo.trim();
    const [owner, name] = repo.split('/');
    const branch = branchMatch ? branchMatch.groups.branch.trim() : 'main';
    const publish_mode = publishMatch ? publishMatch.groups.mode.trim() : 'simple';
    return { owner, name, branch, publish_mode };
  } catch (e) {
    console.error('Error reading config.yml:', e.message);
    throw e;
  }
}

async function generateWithOpenAI(prompt, title) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'dev-key') {
    if (process.env.DEV_USE_FAKE_OPENAI === '1' || process.env.OPENAI_API_KEY === 'dev-key') {
      const mock = await import('./mock.js');
      return mock.simpleGenerate(prompt, title);
    }
    return null;
  }

  const sys = `You are an assistant that writes blog posts in Markdown. Return the full markdown body (no surrounding JSON) with appropriate frontmatter omitted.`;
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: `Write a blog post titled "${title}". ${prompt || ''}` }
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 1000 })
  });
  const json = await res.json();
  if (json && json.choices && json.choices[0] && json.choices[0].message) return json.choices[0].message.content;
  return null;
}

async function composePostWithOpenAI(opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'dev-key') {
    if (process.env.DEV_USE_FAKE_OPENAI === '1' || process.env.OPENAI_API_KEY === 'dev-key') {
      const mock = await import('./mock.js');
      return mock.composePost(opts);
    }
    return null;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const system = `You are a helpful assistant that produces a complete blog post as JSON. Output MUST be valid JSON only. The JSON schema is:{"title":"...","description":"short description","body":"markdown content string","images":[{"prompt":"...","filename_hint":"..."}],"videos":[{"url":"...","caption":"..."}] }`;
  const user = `Create a creative, well-structured blog post about: ${opts.prompt || 'a useful technical topic'}. Provide 1-3 image ideas and optionally include any video URLs to embed. Use Vietnamese language if the site is Vietnamese. Keep images described as short prompts. Don't include extra commentary — return strict JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1500 })
  });
  const json = await res.json();
  if (json && json.choices && json.choices[0] && json.choices[0].message) {
    const txt = json.choices[0].message.content;
    // Try strict JSON first
    try { return JSON.parse(txt); } catch (e) {
      // Attempt to extract JSON substring
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      if (start >= 0 && end >= 0) {
        try { return JSON.parse(txt.slice(start, end+1)); } catch (e2) { /* fallthrough */ }
      }

      // Heuristic parsing when JSON isn't returned: try to extract title/desc/body
      try {
        const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let title = '';
        let description = '';
        let body = '';
        const images = [];
        const videos = [];

        // Look for common labels
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (!title && /^title[:\-]/i.test(l)) { title = l.split(/[:\-]/).slice(1).join(':').trim(); continue; }
          if (!title && /^#\s+/.test(l)) { title = l.replace(/^#\s+/, '').trim(); continue; }
          if (!description && /^description[:\-]/i.test(l)) { description = l.split(/[:\-]/).slice(1).join(':').trim(); continue; }
          if (/^image[:\-]/i.test(l) || /^images?:/i.test(l)) {
            // collect subsequent lines starting with - or * or just URLs
            for (let j = i+1; j < Math.min(lines.length, i+6); j++) {
              const cand = lines[j];
              if (/^[-*]/.test(cand) || /https?:\/\//.test(cand) || cand.length>10) images.push({ prompt: cand.replace(/^[-*]\s*/, '') });
            }
          }
        }

        // If no title found, take first non-heading line as title candidate
        if (!title && lines.length) title = lines[0].slice(0, 80);

        // body: try to find a paragraph after a blank line or after a 'Body' label
        const bodyIdx = lines.findIndex(l => /^body[:\-]/i.test(l));
        if (bodyIdx >= 0) { body = lines.slice(bodyIdx+1).join('\n\n'); }
        else {
          // if multiple paragraphs, take rest as body
          if (lines.length > 2) body = lines.slice(1).join('\n\n');
          else body = lines.join('\n\n');
        }

        return { title: title || '', description: description || '', body: body || '', images, videos };
      } catch (e3) {
        console.warn('Heuristic parse failed', e3 && e3.message ? e3.message : e3);
      }
    }
  }
  return null;
}

async function generateImageWithOpenAI(prompt, size = '1024x1024') {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'dev-key') {
    if (process.env.DEV_USE_FAKE_OPENAI === '1' || process.env.OPENAI_API_KEY === 'dev-key') {
      const mock = await import('./mock.js');
      return mock.generateImage(prompt);
    }
    return null;
  }
  // Use image generation endpoint; request base64 result
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ prompt, n: 1, size, response_format: 'b64_json' })
  });
  const json = await res.json();
  if (json && json.data && json.data[0] && json.data[0].b64_json) return json.data[0].b64_json;
  return null;
}

async function generateTitleWithOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'dev-key') {
    if (process.env.DEV_USE_FAKE_OPENAI === '1' || process.env.OPENAI_API_KEY === 'dev-key') {
      const mock = await import('./mock.js');
      return mock.generateTitle(prompt);
    }
    return null;
  }
  try {
    const messages = [
      { role: 'system', content: 'You are a concise title generator. Return only a short title (max 8 words) for the requested topic.' },
      { role: 'user', content: `Generate a short title for: ${prompt}` }
    ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, max_tokens: 60 })
    });
    const json = await res.json();
    if (json && json.choices && json.choices[0] && json.choices[0].message) return (json.choices[0].message.content || '').trim();
  } catch (e) { console.warn('generateTitleWithOpenAI failed', e && e.message ? e.message : e); }
  return null;
}

async function generateImageWithGenMini(prompt) {
  const key = process.env.GENMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.genmini.ai/v1/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt, size: '1024x1024', format: 'b64' })
    });
    const json = await res.json();
    // Expected shape: { data: [{ b64: '...' }] }
    if (json && json.data && json.data[0] && (json.data[0].b64 || json.data[0].b64_json)) return json.data[0].b64 || json.data[0].b64_json;
  } catch (e) { console.warn('GenMini image generation failed', e && e.message ? e.message : e); }
  return null;
}

async function generateTextWithBing(prompt, title) {
  const key = process.env.BINGAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.bing.microsoft.com/v7.0/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: `${title || ''}\n\n${prompt || ''}` })
    });
    const json = await res.json();
    if (json && json.text) return json.text;
  } catch (e) { console.warn('Bing text generation failed', e && e.message ? e.message : e); }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'MethodNotAllowed' });
    const { title, prompt, commit = true, auto = false, imagesCount = 2, includeVideos = false, secret } = req.body || {};
    const forceFake = (req.body && req.body.forceFake && process.env.NODE_ENV !== 'production');

    // optional admin secret guard
    if (process.env.AI_ADMIN_SECRET) {
      if (!secret || secret !== process.env.AI_ADMIN_SECRET) return res.status(403).json({ ok: false, error: 'forbidden', message: 'missing or invalid secret' });
    }

    let generated = null;
    let finalTitle = title;
    // If auto generation requested, or title missing, ask AI to compose the full post
    if (auto || !finalTitle) {
      try {
        if (forceFake) {
          const mock = await import('./mock.js');
          generated = await mock.composePost({ prompt });
        } else {
          generated = await composePostWithOpenAI({ prompt });
        }
      } catch (e) {
        console.warn('composePostWithOpenAI failed', e && e.message ? e.message : e);
      }

      // If composition failed, fallback to simpler flows:
      if (!generated) {
        // try to generate a reasonable title if missing
        if (!finalTitle) {
          try {
            if (forceFake) {
              const mock = await import('./mock.js');
              finalTitle = (await mock.generateTitle(prompt || 'AI generated post')) || finalTitle;
            } else {
              finalTitle = (await generateTitleWithOpenAI(prompt || 'AI generated post')) || finalTitle;
            }
          } catch (e) { /* ignore */ }
        }

        // If we still don't have a title, derive from prompt
        if (!finalTitle) finalTitle = (prompt && prompt.split('\n')[0].slice(0, 60)) || `ai-post-${Date.now()}`;

        // generate a body using the simpler generator
        try {
          const bodyFallback = await generateWithOpenAI(prompt || '', finalTitle);
          if (bodyFallback) {
            generated = { title: finalTitle, description: '', body: bodyFallback, images: [], videos: [] };
          }
        } catch (e) { console.warn('Fallback body generation failed', e && e.message ? e.message : e); }
      }

      if (generated) {
        finalTitle = generated.title || finalTitle;
      }
    }

    // Determine body and metadata
    let body = null;
    let description = '';
    let images = [];
    let videos = [];

    if (generated) {
      description = generated.description || '';
      body = generated.body || '';
      images = Array.isArray(generated.images) ? generated.images.slice(0, imagesCount) : [];
      videos = Array.isArray(generated.videos) ? generated.videos : [];
    } else {
      try {
        if (forceFake) {
          const mock = await import('./mock.js');
          body = await mock.simpleGenerate(prompt || '', finalTitle);
        } else {
          body = await generateWithOpenAI(prompt || '', finalTitle);
        }
      } catch (e) { console.warn('OpenAI generation failed:', e && e.message ? e.message : e); }
    }

    if (!body) {
      body = `# ${finalTitle}\n\nThis is an AI-generated stub. Replace with your content.`;
    }

    // If images were suggested, attempt to generate them (OpenAI images if available)
    const ghToken = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    const { owner, name, branch, publish_mode } = readRepoInfo();
    const slug = slugify(finalTitle) || `ai-post-${Date.now()}`;

    // Helper: choose image generator (OpenAI -> GenMini)
    async function makeImage(promptText) {
      let b64 = null;
      if (forceFake) {
        const mock = await import('./mock.js');
        b64 = await mock.generateImage(promptText);
      } else {
        if (process.env.OPENAI_API_KEY) {
          b64 = await generateImageWithOpenAI(promptText);
        }
      }
      if (!b64 && process.env.GENMINI_API_KEY) {
        b64 = await generateImageWithGenMini(promptText);
      }
      return b64;
    }

    const uploadedImages = [];
    if (images && images.length && ghToken) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const promptText = img.prompt || img;
        try {
            let b64 = null;
            // Prefer OpenAI image generation, fallback to GenMini
            b64 = await makeImage(promptText);
            if (!b64) {
              console.warn('No image generated for prompt:', promptText);
              continue;
            }
          const fname = `${slug}-${i + 1}.png`;
          const pathInRepo = `public/assets/images/ai/${fname}`;
          const createUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(pathInRepo)}`;
          const createResp = await fetchJson(createUrl, {
            method: 'PUT',
            headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
            body: JSON.stringify({ message: `chore: add AI image ${fname}`, content: b64, branch })
          });
          if (!createResp.ok) {
            console.warn('Failed to upload image', createResp.status, createResp.body);
            continue;
          }
          uploadedImages.push({ prompt: promptText, path: '/' + pathInRepo });
        } catch (e) {
          console.warn('image generation/upload failed', e && e.message ? e.message : e);
        }
      }
    }

    // Replace image placeholders in body if any
    if (uploadedImages.length) {
      let idx = 0;
      body = body.replace(/\!\[.*?\]\(.*?\)/g, function () {
        const p = uploadedImages[idx++] || null;
        return p ? `![](${p.path})` : '';
      });
      // If body has no image placeholders, append first image
      if (!/!\[.*?\]\(.*?\)/.test(body)) {
        body = `![](${uploadedImages[0].path})\n\n` + body;
      }
    }

    // If provider fallback needed (no images suggested but user requested imagesCount),
    // attempt to generate generic images and prepend them.
    if (!uploadedImages.length && imagesCount && imagesCount > 0 && ghToken) {
      for (let j = 0; j < imagesCount; j++) {
        try {
          const promptText = `An illustrative photo for the article titled ${finalTitle}`;
          const b64 = await makeImage(promptText);
          if (!b64) continue;
          const fname = `${slug}-auto-${j + 1}.png`;
          const pathInRepo = `public/assets/images/ai/${fname}`;
          const createUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(pathInRepo)}`;
          const createResp = await fetchJson(createUrl, {
            method: 'PUT',
            headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
            body: JSON.stringify({ message: `chore: add AI image ${fname}`, content: b64, branch })
          });
          if (!createResp.ok) continue;
          uploadedImages.push({ prompt: promptText, path: '/' + pathInRepo });
        } catch (e) { console.warn('auto image generation failed', e && e.message ? e.message : e); }
      }
      if (uploadedImages.length) body = `![](${uploadedImages[0].path})\n\n` + body;
    }

    // Compose final markdown with full frontmatter (but delay slug until filename finalized)
    function composeMarkdown(slugToUse) {
      const publishedDate = getDate();
      const author = process.env.AI_POST_AUTHOR || 'hopthurac';
      const imagePath = uploadedImages[0] ? uploadedImages[0].path : '';
      const tagsYaml = Array.isArray(images) ? '[]' : '[]';
      return `---\ntitle: ${finalTitle}\npublished: ${publishedDate}\nupdated: ${publishedDate}\ndescription: "${(description || '').replace(/"/g, '\\"')}"\nimage: "${imagePath}"\ntags: []\ncategory: ''\nauthor: "${author}"\nslug: "${slugToUse}"\ndraft: ${commit ? 'false' : 'true'}\nlang: "${process.env.DEFAULT_LANG || 'vi'}"\ncanonical: ''\n---\n\n${body}`;
    }

    // If commit not requested or no token, return content only
    if (!commit || !ghToken) {
      const draftContent = composeMarkdown(slug);
      return res.json({ ok: true, committed: false, content: draftContent, generated: generated });
    }

    // Use a timestamp suffix to avoid filename collisions and unnecessary GitHub checks
    const filename = `src/content/posts/${slug}-${Date.now()}.md`;

    // Now that we've finalized a unique filename, compute slug from filename and include it in frontmatter
    const createOnMain = async () => {
      const createUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURI(filename)}`;
      const markdownToWrite = composeMarkdown(filename.split('/').pop().replace(/\.md$/, ''));
      return await fetchJson(createUrl, {
        method: 'PUT',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
        body: JSON.stringify({ message: `chore: create AI post ${finalTitle}`, content: Buffer.from(markdownToWrite).toString('base64'), branch })
      });
    };

    // If the repo is configured with editorial_workflow, create a PR instead of committing directly
    let createResp;
    if (ghToken && (publish_mode === 'editorial_workflow' || process.env.FORCE_PR === '1')) {
      try {
        // 1) get base branch sha
        const refUrl = `https://api.github.com/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`;
        const refResp = await fetchJson(refUrl, { headers: { Authorization: `token ${ghToken}`, 'User-Agent': 'ai-generate' } });
        if (!refResp.ok) throw new Error('failed to fetch base ref');
        const baseSha = refResp.body && refResp.body.object && refResp.body.object.sha;
        const newBranch = `ai-post-${slug}-${Date.now()}`;
        // 2) create new branch
        const createRefUrl = `https://api.github.com/repos/${owner}/${name}/git/refs`;
        const createRefResp = await fetchJson(createRefUrl, {
          method: 'POST', headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
          body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha })
        });
        if (!createRefResp.ok) throw new Error('failed to create branch');
        // 3) create file on new branch
        const createUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURI(filename)}`;
        const markdownToWrite = composeMarkdown(filename.split('/').pop().replace(/\.md$/, ''));
        createResp = await fetchJson(createUrl, {
          method: 'PUT',
          headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
          body: JSON.stringify({ message: `chore: create AI post ${finalTitle}`, content: Buffer.from(markdownToWrite).toString('base64'), branch: newBranch })
        });
        if (!createResp.ok) throw new Error('failed to create file on branch');
        // 4) open PR
        const prUrl = `https://api.github.com/repos/${owner}/${name}/pulls`;
        const prResp = await fetchJson(prUrl, {
          method: 'POST', headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
          body: JSON.stringify({ title: `AI: ${finalTitle}`, head: newBranch, base: branch, body: `Automated AI-generated post: ${finalTitle}` })
        });
        if (!prResp.ok) throw new Error('failed to create PR');
        // Return a response that indicates PR was created
        const prHtml = prResp.body && prResp.body.html_url;
        return res.json({ ok: true, committed: false, pr_url: prHtml, generated: generated, images: uploadedImages });
      } catch (e) {
        console.warn('PR flow failed, falling back to direct commit', e && e.message ? e.message : e);
        createResp = await createOnMain();
      }
    } else {
      createResp = await createOnMain();
    }

    if (!createResp.ok) {
      console.error('Failed to create file', createResp.status, createResp.body);
      return res.status(500).json({ ok: false, error: 'create_failed', details: createResp.body });
    }

    // compute slug from filename
    const createdPath = createResp.body && createResp.body.content && createResp.body.content.path;
    const fname = createdPath ? createdPath.split('/').pop() : (filename.split('/').pop());
    const slugOut = fname ? fname.replace(/\.md$/, '') : slug;

    // Optionally trigger a Vercel (or other) deploy hook so the site is rebuilt
    let deployTriggered = false;
    try {
      const hook = process.env.VERCEL_DEPLOY_HOOK || process.env.DEPLOY_HOOK;
      if (hook) {
        // fire-and-forget trigger; await to ensure it was attempted for observability
        try {
          const resp = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'ai-generate', path: createdPath, slug: slugOut }) });
          deployTriggered = resp && resp.ok;
        } catch (e) {
          console.warn('Deploy hook call failed', e && (e.message || e));
        }
      }
    } catch (e) { /* ignore */ }

    return res.json({ ok: true, committed: true, path: createdPath, html_url: createResp.body.content.html_url, slug: slugOut, generated: generated, images: uploadedImages, deploy_triggered: deployTriggered });
  } catch (err) {
    console.error('AI generate handler error', err);
    res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
}
