
// pages/api/oauth/index.js
export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  const client_id = process.env.OAUTH_CLIENT_ID;
  const siteUrl   = process.env.SITE_URL;

  if (!client_id || !siteUrl) {
    return res.status(500).json({
      error: 'MissingEnv',
      message: 'Required env vars are missing in /api/oauth',
      missing: { OAUTH_CLIENT_ID: !client_id, SITE_URL: !siteUrl },
    });
  }

  // Callback đúng với GitHub OAuth App đã cấu hình
  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  // Dấu '&' thật, KHÔNG dùng &amp;
  const githubAuthURL =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(client_id)}` +
    `&scope=${encodeURIComponent('repo,user')}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}`;

  // Trả 302 để trình duyệt đi tới GitHub
  res.status(302).setHeader('Location', githubAuthURL);
  res.end();
}
