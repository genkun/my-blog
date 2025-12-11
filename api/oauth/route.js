
// app/api/oauth/route.js
export const runtime = 'nodejs';

export async function GET() {
  const client_id = process.env.OAUTH_CLIENT_ID;
  const siteUrl = process.env.SITE_URL;

  if (!client_id || !siteUrl) {
    return new Response(JSON.stringify({
      error: 'MissingEnv',
      message: 'Required env vars are missing in /api/oauth',
      missing: {
        OAUTH_CLIENT_ID: !client_id,
        SITE_URL: !siteUrl,
      },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  const githubAuthURL =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(client_id)}` +
    `&scope=${encodeURIComponent('repo,user')}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}`;

  return Response.redirect(githubAuthURL, 302);
}
