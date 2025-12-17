// api/ai/generate-combo.ts
// Commit bài viết (.md) và ảnh bìa (assets) trong **một** commit GitHub
// Runtime: Node.js (@vercel/node)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'node:buffer';

// ---------- Helpers ----------
function slugifyNoDiacritics(input: string): string {
  return (input || '')
    .normalize('NFD')
    // @ts-ignore - Node supports Unicode property escapes
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
function nowString(): string {
  const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
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
  if (!clean.startsWith('/assets/images/')) return clean; // external URL
  const suffix = clean.replace('/assets/images/', '');
  const base = collection === 'pages' ? '../assets/images/' : '../../assets/images/';
  return base + suffix;
}

// Git commit via REST: blob(base64 for image), tree(with 2 entries), commit, update ref
async function commitComboToGithub(opts: {
  owner: string; repo: string; branch: string; token: string;
  mdUtf8: string; mdPath: string;
  imageBase64: string; imagePath: string;
  message: string;
}): Promise<{ ok: boolean; html_url?: string; error?: any; stage?: string; }>
{
  const { owner, repo, branch, token, mdUtf8, mdPath, imageBase64, imagePath, message } = opts;
  const accept = 'application/vnd.github+json';

  // 1) Get ref
  const getRef = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept }
  });
  if (!getRef.ok) return { ok: false, stage: 'getRef', error: await getRef.text() };
  const refJson = await getRef.json(); const latestCommitSha = refJson.object?.sha;
  if (!latestCommitSha) return { ok: false, stage: 'getRef.parse', error: refJson };

  // 2) Create blobs: md (utf-8) & image (base64)
  const blobMdResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept },
    body: JSON.stringify({ content: mdUtf8, encoding: 'utf-8' })
  });
  const blobMd = await blobMdResp.json(); if (!blobMd.sha) return { ok: false, stage: 'blobMd', error: blobMd };

  const blobImgResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept },
    body: JSON.stringify({ content: imageBase64, encoding: 'base64' })
  });
  const blobImg = await blobImgResp.json(); if (!blobImg.sha) return { ok: false, stage: 'blobImg', error: blobImg };

  // 3) Base tree
  const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept }
  });
  const commitJson = await commitResp.json(); const baseTree = commitJson.tree?.sha; if (!baseTree) return { ok: false, stage: 'getCommitTree', error: commitJson };

  // 4) Create tree with two entries
  const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept },
    body: JSON.stringify({
      base_tree: baseTree,
      tree: [
        { path: mdPath,   mode: '100644', type: 'blob', sha: blobMd.sha },
        { path: imagePath, mode: '100644', type: 'blob', sha: blobImg.sha }
      ]
    })
  });
  const treeJson = await treeResp.json(); if (!treeJson.sha) return { ok: false, stage: 'createTree', error: treeJson };

  // 5) Create commit
  const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: accept },
    body: JSON.stringify({ message, tree: treeJson.sha, parents: [ latestCommitSha ] })
  });
  const newCommitJson = await newCommitResp.json(); if (!newCommitJson.sha) return { ok: false, stage: 'createCommit', error: newCommitJson };

  // 6) Update ref
  const updateRefResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: accept },
    body: JSON.stringify({ sha: newCommitJson.sha })
  });
  if (!updateRefResp.ok) return { ok: false, stage: 'updateRef', error: await updateRefResp.text() };

  return { ok: true, html_url: `https://github.com/${owner}/${repo}/commit/${newCommitJson.sha}` };
}

// ---------- Handler ----------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const {
      title,
      slug: slugClient,
      bodyPrompt,
      image_url,
      prompt,            // cover prompt (ưu tiên)
      commit = true,
      collection = 'blog',
      provider,          // 'openai' (optional)
      author,
      lang,
    } = (req.body || {});

    if (!title) return res.status(400).json({ ok: false, error: 'missing title' });

    const safeSlug = slugifyNoDiacritics(slugClient || title);
    const d = new Date(); const yyyy = d.getFullYear(); const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    const mdFilename = `${yyyy}-${mm}-${dd}-${safeSlug}.md`;
    const mdRepoPath = `src/content/posts/${mdFilename}`;  // adjust for pages if needed

    // ---- Create/Import image bytes ----
    let bytes: Uint8Array | null = null; let contentType: string | null = null;

    if (!bytes && image_url) {
      const r = await fetch(String(image_url));
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'fetch image failed', detail: await r.text() });
      const ab = await r.arrayBuffer(); bytes = new Uint8Array(ab); contentType = r.headers.get('content-type');
    }

    if (!bytes && (prompt || title) && (provider === 'openai' || (!provider && process.env.OPENAI_API_KEY))) {
      const key = process.env.OPENAI_API_KEY;
      if (key) {
        const coverPrompt = String(prompt || `Ảnh bìa minimal cho: ${title}`);
        const resp = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-image-1', prompt: coverPrompt, size: '1024x1024' })
        });
        const j = await resp.json();
        const b64 = j?.data?.[0]?.b64_json;
        if (b64) { const raw = Buffer.from(String(b64), 'base64'); bytes = new Uint8Array(raw); contentType = 'image/png'; }
      }
    }

    if (!bytes) {
      const du = `https://dummyimage.com/1200x630/0b7285/ffffff&text=${encodeURIComponent(title)}`;
      const r = await fetch(du); const ab = await r.arrayBuffer(); bytes = new Uint8Array(ab); contentType = r.headers.get('content-type');
    }

    const ext = toExtFromContentType(contentType); const imgId = ulid(); const imgName = `${imgId}.${ext}`;
    const imgRepoPath = `src/assets/images/${imgName}`; // commit path
    const imgPublicPath = `/assets/images/${imgName}`;  // public path
    const imgRelPath = relPathForCollection(imgPublicPath, String(collection));

    // ---- Compose Markdown frontmatter + body ----
    const fm = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `slug: ${JSON.stringify(safeSlug)}`,
      `published: ${JSON.stringify(nowString())}`,
      `author: ${JSON.stringify(author || process.env.DEFAULT_AUTHOR || 'hopthurac')}`,
      `lang: ${JSON.stringify(lang || process.env.DEFAULT_LANG || 'vi')}`,
      `image: ${JSON.stringify(imgRelPath)}`,
      '---',
      ''
    ].join('\n');

    const body = `# ${title}\n\n> (AI demo) Nội dung tự động dựa trên tiêu đề.\n\n## Bối cảnh\nMô tả ngắn gọn...\n\n## Các bước\n- Bước 1\n- Bước 2\n\n## Lưu ý\n- ...\n\n`;

    const mdUtf8 = fm + (bodyPrompt ? String(bodyPrompt) : body);

    if (!commit) {
      return res.status(200).json({ ok: true, committed: false, md_path: mdRepoPath, image_path: imgPublicPath, rel_path: imgRelPath, content: mdUtf8 });
    }

    // ---- Commit ONE SHOT ----
    const ownerRepo = (process.env.GITHUB_REPO || '').split('/');
    if (ownerRepo.length !== 2) return res.status(400).json({ ok: false, error: 'GITHUB_REPO must be owner/repo' });
    const [owner, repo] = ownerRepo; const branch = process.env.GITHUB_BRANCH || 'main';
    const token = process.env.AI_GITHUB_TOKEN || process.env.GITHUB_TOKEN; if (!token) return res.status(400).json({ ok: false, error: 'Missing AI_GITHUB_TOKEN' });

    const imageBase64 = Buffer.from(bytes!).toString('base64');
    const message = `content(blog): add ${safeSlug} + cover ${imgName}`;

    const result = await commitComboToGithub({ owner, repo, branch, token, mdUtf8, mdPath: mdRepoPath, imageBase64, imagePath: imgRepoPath, message });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error, stage: result.stage });

    return res.status(200).json({ ok: true, committed: true, md_path: mdRepoPath, image_path: imgPublicPath, rel_path: imgRelPath, html_url: result.html_url });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
  }
}
