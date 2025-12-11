
// pages/api/oauth/index.js hoặc app/api/oauth/route.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id = process.env.OAUTH_CLIENT_ID;
  const siteUrl = process.env.SITE_URL;
  if (!client_id || !siteUrl) {
    return res.status(500).json({ error: 'MissingEnv' });
  }
  const redirect_uri = `${siteUrl}/api/oauth/callback`;
  const githubAuthURL =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(client_id)}` +
    `&scope=${encodeURIComponent('repo,user')}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}`;
  res.status(302).setHeader('Location', githubAuthURL);
  res.end();
}
