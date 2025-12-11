
// /api/oauth/start.js
export const config = { runtime: 'nodejs' };

function randomState() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default async function handler(req, res) {
  const client_id = process.env.OAUTH_CLIENT_ID;
  const siteUrl   = process.env.SITE_URL;
  const scope     = 'repo,user'; // tuỳ nhu cầu, thường 'repo' đủ cho GitHub backend
  const state     = randomState();
  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  if (!client_id || !siteUrl) {
    return res.status(500).json({ error: 'MissingEnv' });
  }

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirect_uri);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);

  // Nếu bạn muốn chống CSRF, lưu state vào cookie/session (không bắt buộc với demo)
  // res.setHeader('Set-Cookie', ...)

  return res.redirect(authorizeUrl.toString());
}
