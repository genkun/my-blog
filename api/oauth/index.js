
// /api/oauth/index.js
export const config = { runtime: 'nodejs' };

function rand(n = 32) {
  return [...crypto.getRandomValues(new Uint8Array(n))]
    .map(b => ('0' + b.toString(16)).slice(-2)).join('');
}

function signState(state, secret) {
  // Ký đơn giản: concat + HMAC-SHA256 (Node built-in webcrypto mới)
  return state; // Nếu muốn HMAC, có thể triển khai thêm; giữ nguyên state để callback đối chiếu cookie.
}

export default async function handler(req, res) {
  try {
    const siteUrl       = process.env.SITE_URL;
    const client_id     = process.env.OAUTH_CLIENT_ID;
    const scope         = process.env.OAUTH_SCOPE || 'repo';
    const host          = process.env.OAUTH_HOSTNAME || 'github.com';
    const cookieSecret  = process.env.COOKIE_SECRET || '';

    if (!client_id || !siteUrl) {
      return res.status(500).json({
        error: 'MissingEnv',
        missing: {
          OAUTH_CLIENT_ID: !client_id,
          SITE_URL: !siteUrl
        }
      });
    }

    // Tạo state & lưu vào cookie để xác thực ở callback
    const stateRaw = rand(16);
    const stateSig = signState(stateRaw, cookieSecret);
    const state    = `${stateRaw}:${stateSig}`;

    // Cookie: SameSite=Lax (đủ cho OAuth), Secure, HttpOnly
    res.setHeader('Set-Cookie', [
      `oauth_state=${encodeURIComponent(state)}; Path=/; Max-Age=600; SameSite=Lax; Secure; HttpOnly`
    ]);

    const redirect_uri = `${siteUrl}/api/oauth/callback`;

    // URL authorize GitHub
    const authorizeUrl = new URL(`https://${host}/login/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirect_uri);
    authorizeUrl.searchParams.set('scope', scope);
    authorizeUrl.searchParams.set('state', stateRaw);

    // 302 chuyển hướng tới GitHub (popup sẽ theo link này)
    res.status(302).setHeader('Location', authorizeUrl.toString()).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ServerError', message: err.message });
  }
}
