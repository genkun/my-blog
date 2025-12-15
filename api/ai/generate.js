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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'MethodNotAllowed' });

    const { title, prompt, commit = true } = req.body || {};
    if (!title) return res.status(400).json({ error: 'missing_title' });

    // Generate content
    let body = null;
    try {
      body = await generateWithOpenAI(prompt || '', title);
    } catch (e) {
      console.warn('OpenAI generation failed:', e.message || e);
    }

    // fallback content
    if (!body) {
      body = `# ${title}\n\nThis is an AI-generated stub. Replace with your content.`;
    }

    // Compose final markdown with frontmatter
    const markdown = `---\ntitle: ${title}\npublished: ${getDate()}\ndescription: ''\nimage: ''\ntags: []\ncategory: ''\ndraft: true\nlang: ''\n---\n\n${body}`;

    // If commit not requested or no token, return content only
    const ghToken = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (!commit || !ghToken) {
      return res.json({ ok: true, committed: false, content: markdown });
    }

    const { owner, name, branch } = readRepoInfo();
    const slug = slugify(title) || `ai-post-${Date.now()}`;
    let filename = `src/content/posts/${slug}.md`;

    // ensure unique filename: try suffixes if exists
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
      body: JSON.stringify({ message: `chore: create AI post ${title}`, content: Buffer.from(markdown).toString('base64'), branch })
    });

    if (!createResp.ok) {
      console.error('Failed to create file', createResp.status, createResp.body);
      return res.status(500).json({ ok: false, error: 'create_failed', details: createResp.body });
    }

    return res.json({ ok: true, committed: true, path: createResp.body.content.path, html_url: createResp.body.content.html_url });
  } catch (err) {
    console.error('AI generate handler error', err);
    res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
}
