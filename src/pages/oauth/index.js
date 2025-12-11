
// pages/api/oauth/index.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id = process.env.OAUTH_CLIENT_ID;
  const siteUrl = process.env.SITE_URL;

  // Validate env
  if (!client_id || !siteUrl) {
    return res.status(500).json({
      error: 'MissingEnv',
      message: 'Required env vars are missing in /api/oauth',
      missing: {
        OAUTH_CLIENT_ID: !client_id,
        SITE_URL: !siteUrl,
      },
    });
  }

  // redirect_uri trỏ đến endpoint callback riêng
  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  const githubAuthURL =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(client_id)}` +
    `&scope=${encodeURIComponent('repo,user')}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}`;

  // Chuyển hướng người dùng tới GitHub để approve
  return res.redirect(githubAuthURL);
}
