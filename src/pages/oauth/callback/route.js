
// app/api/oauth/callback/route.js
export const runtime = 'nodejs';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  const client_id = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.SITE_URL;

  if (!client_id || !client_secret || !siteUrl) {
    return new Response(JSON.stringify({
      error: 'MissingEnv',
      message: 'Required env vars are missing in /api/oauth/callback',
      missing: {
        OAUTH_CLIENT_ID: !client_id,
        OAUTH_CLIENT_SECRET: !client_secret,
        SITE_URL: !siteUrl,
      },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  if (!code) {
    return new Response(JSON.stringify({ error: 'MissingCode', message: 'OAuth "code" is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  const tokenResponse = await fetch(`https://github.com/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri }),
  });
  const tokenData = await tokenResponse.json();

  if (tokenData.error) {
    return new Response(JSON.stringify({
      error: tokenData.error,
      description: tokenData.error_description,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const token = tokenData.access_token || tokenData.token;
  if (!token) {
    return new Response(JSON.stringify({ error: 'NoAccessToken', details: tokenData }),
      { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ token }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
