// /api/ai/generate.js
export const config = { runtime: 'nodejs' };

import fs from 'fs';
import path from 'path';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, body: json };
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
    if (!repoMatch) throw new Error('repo not found in ' + cfgPath);
    const repo = repoMatch.groups.repo.trim();
    const [owner, name] = repo.split('/');
    const branch = branchMatch ? branchMatch.groups.branch.trim() : 'main';
    return { owner, name, branch };
  } catch (e) {
    console.error('Error reading config.yml:', e.message);
    throw e;
  }
}

async function generateWithOpenAI(prompt, title) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

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
  if (!key) return null;

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
    try { return JSON.parse(txt); } catch (e) {
      // try to extract JSON substring
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      if (start >= 0 && end >= 0) {
        try { return JSON.parse(txt.slice(start, end+1)); } catch (e2) { /* fallthrough */ }
      }
    }
  }
  return null;
}

async function generateImageWithOpenAI(prompt, size = '1024x1024') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
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
    const { title, prompt, commit = true, auto = false, imagesCount = 2, includeVideos = false } = req.body || {};

    let generated = null;
    let finalTitle = title;
    // If auto generation requested, or title missing, ask AI to compose the full post
    if (auto || !finalTitle) {
      try {
        generated = await composePostWithOpenAI({ prompt });
      } catch (e) {
        console.warn('composePostWithOpenAI failed', e && e.message ? e.message : e);
      }
      if (generated) {
        finalTitle = generated.title || finalTitle;
      }
    }

    if (!finalTitle) return res.status(400).json({ error: 'missing_title' });

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
        body = await generateWithOpenAI(prompt || '', finalTitle);
      } catch (e) { console.warn('OpenAI generation failed:', e && e.message ? e.message : e); }
    }

    if (!body) {
      body = `# ${finalTitle}\n\nThis is an AI-generated stub. Replace with your content.`;
    }

    // If images were suggested, attempt to generate them (OpenAI images if available)
    const ghToken = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    const { owner, name, branch } = readRepoInfo();
    const slug = slugify(finalTitle) || `ai-post-${Date.now()}`;

    // Helper: choose image generator (OpenAI -> GenMini)
    async function makeImage(promptText) {
      let b64 = null;
      if (process.env.OPENAI_API_KEY) {
        b64 = await generateImageWithOpenAI(promptText);
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

    // Compose final markdown with frontmatter
    const markdown = `---\ntitle: ${finalTitle}\npublished: ${getDate()}\ndescription: "${(description || '').replace(/"/g, '\\"')}"\nimage: "${uploadedImages[0] ? uploadedImages[0].path : ''}"\ntags: []\ncategory: ''\ndraft: ${commit ? 'false' : 'true'}\nlang: ''\n---\n\n${body}`;

    // If commit not requested or no token, return content only
    if (!commit || !ghToken) {
      return res.json({ ok: true, committed: false, content: markdown, generated: generated });
    }

    let filename = `src/content/posts/${slug}.md`;
    // ensure unique filename
    let i = 0;
    while (true) {
      const checkUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(filename)}`;
      const check = await fetchJson(checkUrl + `?ref=${encodeURIComponent(branch)}`, { headers: { Authorization: `token ${ghToken}`, 'User-Agent': 'ai-generate' } });
      if (!check.ok) break; // not found
      i++; filename = `src/content/posts/${slug}-${i}.md`;
    }

    const createUrl = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(filename)}`;
    const createResp = await fetchJson(createUrl, {
      method: 'PUT',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json', 'User-Agent': 'ai-generate' },
      body: JSON.stringify({ message: `chore: create AI post ${finalTitle}`, content: Buffer.from(markdown).toString('base64'), branch })
    });

    if (!createResp.ok) {
      console.error('Failed to create file', createResp.status, createResp.body);
      return res.status(500).json({ ok: false, error: 'create_failed', details: createResp.body });
    }

    // compute slug from filename
    const createdPath = createResp.body && createResp.body.content && createResp.body.content.path;
    const fname = createdPath ? createdPath.split('/').pop() : (filename.split('/').pop());
    const slugOut = fname ? fname.replace(/\.md$/, '') : slug;

    return res.json({ ok: true, committed: true, path: createdPath, html_url: createResp.body.content.html_url, slug: slugOut, generated: generated, images: uploadedImages });
  } catch (err) {
    console.error('AI generate handler error', err);
    res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
}
