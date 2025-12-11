
// /api/oauth/callback.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id     = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;
  const siteUrl       = process.env.SITE_URL;
  const host          = process.env.OAUTH_HOSTNAME || 'github.com';

  if (!client_id || !client_secret || !siteUrl) {
    return res.status(500).json({
      error: 'MissingEnv',
      missing: {
        OAUTH_CLIENT_ID: !client_id,
        OAUTH_CLIENT_SECRET: !client_secret,
        SITE_URL: !siteUrl
      }
    });
  }

  const { code, state } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'MissingCode', message: 'OAuth "code" is required' });
  }

  // Xác thực 'state' đơn giản: so cookie == stateRaw (trước dấu ':')
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/);
  const savedState = match ? decodeURIComponent(match[1]) : '';
  const savedRaw   = savedState.split(':')[0];

  if (!savedRaw || savedRaw !== state) {
    // Không chặn hoàn toàn để tránh kẹt, nhưng cảnh báo
    console.warn('State mismatch:', { savedRaw, state });
  }

  const redirect_uri = `${siteUrl}/api/oauth/callback`;

  // 1) Đổi code lấy access_token từ GitHub
  const tokenResp = await fetch(`https://${host}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri })
  });

  const tokenData = await tokenResp.json();
  if (tokenData.error) {
    return res.status(400).json({
      error: tokenData.error,
      description: tokenData.error_description
    });
  }

  const token = tokenData.access_token || tokenData.token;
  if (!token) return res.status(400).json({ error: 'NoAccessToken', details: tokenData });

  // 2) Payload theo format Decap (v3):
  //    'authorization:github:success:<JSON>'
  const content = { token, provider: 'github', backend: 'github', state };
  const msgDecap   = `authorization:github:success:${JSON.stringify(content)}`;
  const msgNetlify = `netlify-cms-oauth-provider:${JSON.stringify(content)}`; // dự phòng

  const targetOrigin = siteUrl; // an toàn: origin đúng trang admin

  // 3) Trả về HTML: postMessage tới cửa sổ cha rồi đóng popup
  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Đang hoàn tất đăng nhập…</title>
  <meta name="robots" content="noindex" />
  <style>body{font-family:system-ui; margin:2rem;}</style>
</head>
<body>
  <p>Đăng nhập GitHub thành công. Đang chuyển về CMS…</p>
  <script>
    (function() {
      var msg1 = ${JSON.stringify(msgDecap)};
      var msg2 = ${JSON.stringify(msgNetlify)};
      var origin = ${JSON.stringify(targetOrigin)};

      function send(target) {
        try {
          if (target && typeof target.postMessage === 'function') {
            target.postMessage(msg1, origin);
            target.postMessage(msg2, origin);
            return true;
          }
        } catch (e) { console.error('postMessage error:', e); }
        return false;
      }

      var ok = false;
      if (window.opener && !window.opener.closed) ok = send(window.opener);
      if (!ok && window.parent && window.parent !== window) ok = send(window.parent);

      // (Tuỳ chọn) thử '*' trong quá trình test, sau đó nên bỏ để an toàn
      if (!ok) {
        try {
          if (window.opener && !window.opener.closed) { window.opener.postMessage(msg1, '*'); window.opener.postMessage(msg2, '*'); ok = true; }
          else if (window.parent && window.parent !== window) { window.parent.postMessage(msg1, '*'); window.parent.postMessage(msg2, '*'); ok = true; }
        } catch (e) {}
      }

      setTimeout(function(){ window.close(); }, 800);
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
