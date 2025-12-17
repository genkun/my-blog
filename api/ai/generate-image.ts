// api/ai/generate-image.ts (auto import cover image + commit to GitHub)
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---- Utils ----
function ulid(): string {
  const abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const encTime = (n: number, len = 10) => {
    let s = '';
    while (len--) { s = abc[n % 32] + s; n = Math.floor(n / 32); }
    return s;
  };
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
  // Convert /assets/images/xxx.ext -> relative path to use in frontmatter for Astro assets
  const clean = publicPath.replace(/^\/+/, '/');
  if (!clean.startsWith('/assets/images/')) return clean;
  const suffix = clean.replace('/assets/images/', '');
  const base = collection === 'pages' ? '../assets/images/' : '../../assets/images/';
  return base + suffix;
}

async function commitBytesToGithub(opts: {
  owner: string; repo: string; branch: string; token: string;
  bytesBase64: string; path: string; message: string;
}): Promise<{ ok: boolean; commitSha?: string; html_url?: string; error?: any; }> {
  const { owner, repo, branch, token, bytesBase64, path, message } = opts;

  // Get branch ref
  const getRef = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
  });
  if (!getRef.ok) return { ok: false, error: await getRef.json() };
  const refJson = await getRef.json();
  const latestCommitSha = refJson.object.sha;

  // Create blob (base64 encoding)
  const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({ content: bytesBase64, encoding: 'base64' })
  });
  const blob = await blobResp.json();
  if (!blob.sha) return { ok: false, error: blob };

  // Get base tree
  const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
  });
  const commitJson = await commitResp.json();
  const baseTree = commitJson.tree.sha;

  // Create new tree with asset
  const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({ base_tree: baseTree, tree: [ { path, mode: '100644', type: 'blob', sha: blob.sha } ] })
  });
  const treeJson = await treeResp.json();
  if (!treeJson.sha) return { ok: false, error: treeJson };

  // Create commit
  const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({ message, tree: treeJson.sha, parents: [ latestCommitSha ] })
  });
  const newCommitJson = await newCommitResp.json();
  if (!newCommitJson.sha) return { ok: false, error: newCommitJson };

  // Update ref
  const updateRefResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({ sha: newCommitJson.sha })
  });
  if (!updateRefResp.ok) return { ok: false, error: await updateRefResp.json() };

  return { ok: true, commitSha: newCommitJson.sha, html_url: `https://github.com/${owner}/${repo}/commit/${newCommitJson.sha}` };
}

// ---- Handler ----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { prompt, image_url, commit, collection = 'blog', provider } = (req.body || {});

    // Prepare bytes
    let bytes: Uint8Array | null = null;
    let contentType: string | null = null;

    // Strategy 1: external URL import
    if (!bytes && image_url) {
      const r = await fetch(image_url);
      if (!r.ok) return res.status(r.status).json({ ok: false, error: `fetch image failed`, detail: await r.text() });
      const ab = await r.arrayBuffer();
      bytes = new Uint8Array(ab);
      contentType = r.headers.get('content-type');
    }

    // Strategy 2: OpenAI images (optional)
    if (!bytes && prompt && (provider === 'openai' || (!provider && process.env.OPENAI_API_KEY))) {
      try {
        const openaiEndpoint = 'https://api.openai.com/v1/images/generations';
        const resp = await fetch(openaiEndpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', response_format: 'b64_json' })
        });
        const j = await resp.json();
        if (j && j.data && j.data[0] && j.data[0].b64_json) {
          const b64 = j.data[0].b64_json as string;
          const raw = Buffer.from(b64, 'base64');
          bytes = new Uint8Array(raw);
          contentType = 'image/png';
        } else {
          console.warn('OpenAI images returned no data', j);
        }
      } catch (e) {
        console.warn('OpenAI image generation failed', e);
      }
    }

    // Strategy 3: Dummy placeholder
    if (!bytes) {
      const du = `https://dummyimage.com/1200x630/0b7285/ffffff&text=${encodeURIComponent(prompt || 'cover')}`;
      const r = await fetch(du);
      const ab = await r.arrayBuffer();
      bytes = new Uint8Array(ab);
      contentType = r.headers.get('content-type');
    }

    // Decide filename/path
    const ext = toExtFromContentType(contentType);
    const id = ulid();
    const fname = `${id}.${ext}`;
    const repoPath = `src/assets/images/${fname}`; // commit path in repo
    const publicPath = `/assets/images/${fname}`;  // public URL after build

    // If not committing, just return bytes as data URL (optional) or public path (virtually)
    if (!commit) {
      return res.status(200).json({ ok: true, path: publicPath, committed: false, content_type: contentType });
    }

    // Commit to GitHub
    const ownerRepo = (process.env.GITHUB_REPO || '').split('/');
    if (ownerRepo.length !== 2) return res.status(400).json({ ok: false, error: 'GITHUB_REPO must be owner/repo' });
    const [owner, repo] = ownerRepo;
    const branch = process.env.GITHUB_BRANCH || 'main';
    const token = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) return res.status(400).json({ ok: false, error: 'Missing AI_GITHUB_TOKEN' });

    const base64 = Buffer.from(bytes!).toString('base64');
    const commitResult = await commitBytesToGithub({ owner, repo, branch, token, bytesBase64: base64, path: repoPath, message: `assets: add cover ${fname}` });
    if (!commitResult.ok) return res.status(400).json({ ok: false, error: commitResult.error });

    // Also return relative asset path for frontmatter (Astro assets)
    const rel = relPathForCollection(publicPath, String(collection));
    return res.status(200).json({ ok: true, committed: true, path: publicPath, repo_path: repoPath, rel_path: rel, html_url: commitResult.html_url });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
  }
}
