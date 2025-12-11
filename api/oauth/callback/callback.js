
// pages/api/oauth/callback.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id     = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;
  const siteUrl       = process.env.SITE_URL;

  if (!client_id || !client_secret || !siteUrl) {
    return res.status(500).json({
      error: 'MissingEnv',
      message: 'Required env vars are missing in /api/oauth/callback',
      missing: {
        OAUTH_CLIENT_ID: !client_id,
        OAUTH_CLIENT_SECRET: !client_secret,
        SITE_URL: !siteUrl,
      },
    });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'MissingCode', message: 'OAuth "code" is required' });
  }

  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  // Đổi code lấy access_token từ GitHub
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri }),
  });

  const tokenData = await tokenResp.json();

  if (tokenData.error) {
    return res.status(400).json({
      error: tokenData.error,
      description: tokenData.error_description,
    });
  }

  const token = tokenData.access_token || tokenData.token;
  if (!token) return res.status(400).json({ error: 'NoAccessToken', details: tokenData });

  // Decap CMS mong đợi { token: "<access_token>" }
  return res.json({ token });
}
