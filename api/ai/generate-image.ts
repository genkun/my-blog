// api/ai/generate-image.ts (patched: robust, Node runtime, explicit Buffer import)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'node:buffer';

function ulid(): string {
  const abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const encTime = (n: number, len = 10) => { let s = ''; while (len--) { s = abc[n % 32] + s; n = Math.floor(n / 32); } return s; };
  const encRand = (len = 16) => Array.from({ length: len }, () => abc[Math.floor(Math.random() * 32)]).join('');
  return encTime(Date.now()) + encRand();
}
function toExtFromContentType(ct: string | null): string {
  if (!ct) return 'png';
  ct = ct.toLowerCase();
  if (ct.includes('image/png')) return 'png';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return 'jpg';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/svg')) return 'svg';
  return 'png';
}
function relPathForCollection(publicPath: string, collection: string): string {
  const clean = publicPath.replace(/^\/+/, '/');
  if (!clean.startsWith('/assets/images/')) return clean;
  const suffix = clean.replace('/assets/images/', '');
  const base = collection === 'pages' ? '../assets/images/' : '../../assets/images/';
  return base + suffix;
}
async function commitBytesToGithub(opts: { owner: string; repo: string; branch: string; token: string; bytesBase64: string; path: string; message: string; }) {
  const { owner, repo, branch, token, bytesBase64, path, message } = opts;
  const accept = 'application/vnd.github+json';
  const getRef = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
  if (!getRef.ok) return { ok: false, stage: 'getRef', error: await getRef.text() };
  const refJson = await getRef.json(); const latestCommitSha = refJson.object?.sha;
  if (!latestCommitSha) return { ok: false, stage: 'getRef.parse', error: refJson };

  const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept }, body: JSON.stringify({ content: bytesBase64, encoding: 'base64' })
  });
  const blob = await blobResp.json(); if (!blob.sha) return { ok: false, stage: 'createBlob', error: blob };

  const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
  const commitJson = await commitResp.json(); const baseTree = commitJson.tree?.sha; if (!baseTree) return { ok: false, stage: 'getCommitTree', error: commitJson };

  const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept }, body: JSON.stringify({ base_tree: baseTree, tree: [ { path, mode: '100644', type: 'blob', sha: blob.sha } ] })
  });
  const treeJson = await treeResp.json(); if (!treeJson.sha) return { ok: false, stage: 'createTree', error: treeJson };

  const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept }, body: JSON.stringify({ message, tree: treeJson.sha, parents: [ latestCommitSha ] })
  });
  const newCommitJson = await newCommitResp.json(); if (!newCommitJson.sha) return { ok: false, stage: 'createCommit', error: newCommitJson };

  const updateRefResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: accept }, body: JSON.stringify({ sha: newCommitJson.sha })
  });
  if (!updateRefResp.ok) return { ok: false, stage: 'updateRef', error: await updateRefResp.text() };

  return { ok: true, commitSha: newCommitJson.sha, html_url: `https://github.com/${owner}/${repo}/commit/${newCommitJson.sha}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { prompt, image_url, commit, collection = 'blog', provider } = (req.body || {});

    // Acquire bytes
    let bytes: Uint8Array | null = null; let contentType: string | null = null;

    if (!bytes && image_url) {
      const r = await fetch(String(image_url)); if (!r.ok) return res.status(r.status).json({ ok: false, error: 'fetch image failed', detail: await r.text() });
      const ab = await r.arrayBuffer(); bytes = new Uint8Array(ab); contentType = r.headers.get('content-type');
    }

    // OpenAI images (gpt-image-1 returns base64 only)
    if (!bytes && prompt && (provider === 'openai' || (!provider && process.env.OPENAI_API_KEY))) {
      const key = process.env.OPENAI_API_KEY; if (!key) console.warn('OPENAI_API_KEY missing; skipping OpenAI generation');
      if (key) {
        const resp = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024' /* gpt-image-1 always b64_json */ })
        });
        const j = await resp.json();
        const b64 = j?.data?.[0]?.b64_json; if (b64) { const raw = Buffer.from(String(b64), 'base64'); bytes = new Uint8Array(raw); contentType = 'image/png'; }
      }
    }

    if (!bytes) {
      const du = `https://dummyimage.com/1200x630/0b7285/ffffff&text=${encodeURIComponent(prompt || 'cover')}`;
      const r = await fetch(du); const ab = await r.arrayBuffer(); bytes = new Uint8Array(ab); contentType = r.headers.get('content-type');
    }

    const ext = toExtFromContentType(contentType); const id = ulid(); const fname = `${id}.${ext}`;
    const repoPath = `src/assets/images/${fname}`; const publicPath = `/assets/images/${fname}`;

    if (!commit) return res.status(200).json({ ok: true, path: publicPath, committed: false, content_type: contentType });

    const ownerRepo = (process.env.GITHUB_REPO || '').split('/'); if (ownerRepo.length !== 2) return res.status(400).json({ ok: false, error: 'GITHUB_REPO must be owner/repo' });
    const [owner, repo] = ownerRepo; const branch = process.env.GITHUB_BRANCH || 'main'; const token = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) return res.status(400).json({ ok: false, error: 'Missing AI_GITHUB_TOKEN' });

    const base64 = Buffer.from(bytes!).toString('base64');
    const commitResult = await commitBytesToGithub({ owner, repo, branch, token, bytesBase64: base64, path: repoPath, message: `assets: add cover ${fname}` });
    if (!commitResult.ok) return res.status(400).json({ ok: false, error: commitResult.error });

    const rel = relPathForCollection(publicPath, String(collection));
    return res.status(200).json({ ok: true, committed: true, path: publicPath, repo_path: repoPath, rel_path: rel, html_url: commitResult.html_url });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
  }
}
