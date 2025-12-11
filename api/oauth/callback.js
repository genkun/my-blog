
// /api/oauth/callback.js (Vercel Serverless Function)
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id     = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;
  const siteUrl       = process.env.SITE_URL;                 // ví dụ: https://blog.thien.ac
  const host          = process.env.OAUTH_HOSTNAME || 'github.com';

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

  const { code, state } = req.query;
  if (!code) return res.status(400).json({ error: 'MissingCode', message: 'OAuth "code" is required' });

  // Lấy origin từ query/cookie
  const cookieHeader     = req.headers.cookie || '';
  const cookieOriginRaw  = (cookieHeader.match(/(?:^|;\s*)oauth_origin=([^;]+)/) || [])[1];
  const originFromCookie = cookieOriginRaw ? decodeURIComponent(cookieOriginRaw) : '';
  const originFromQuery  = (req.query.origin && String(req.query.origin)) || '';
  const targetOrigin     = originFromQuery || originFromCookie || siteUrl;

  // (tuỳ chọn) xác thực state đơn giản
  const cookieStateRaw = (cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/) || [])[1];
  const savedState     = cookieStateRaw ? decodeURIComponent(cookieStateRaw) : '';
  if (!savedState || savedState !== state) {
    console.warn('State mismatch:', { savedState, state });
  }

  // redirect_uri phải KHỚP GitHub OAuth App (callback: https://blog.thien.ac/api/oauth/callback)
  const redirect_uri = `${siteUrl}/api/oauth/callback?origin=${encodeURIComponent(targetOrigin)}`;

  // 1) Đổi code lấy access_token
  let tokenData;
  try {
    const tokenResp = await fetch(`https://${host}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({ client_id, client_secret, code, redirect_uri }),
    });
    tokenData = await tokenResp.json();
  } catch (e) {
    return res.status(502).json({ error: 'TokenExchangeFailed', message: e.message });
  }

  if (tokenData.error) {
    return res.status(400).json({ error: tokenData.error, description: tokenData.error_description });
  }

  const token = tokenData.access_token || tokenData.token;
  if (!token) return res.status(400).json({ error: 'NoAccessToken', details: tokenData });

  // 2) Chuẩn hoá nhiều FORMAT message mà Decap/Netlify từng dùng
  const jsonPayload  = JSON.stringify({ token, provider: 'github', backend: 'github', state });
  const formats = [
    // format “chuẩn” của Decap v3 (phổ biến)
    `authorization:github:success:${jsonPayload}`,
    // dự phòng Netlify CMS OAuth provider (nhiều repo dùng format này)
    `netlify-cms-oauth-provider:${jsonPayload}`,
    // một số bản fork/phiên bản cũ dùng token dạng chuỗi sau prefix
    `authorization:github:success:${token}`,
    // biến thể ít gặp, thử thêm để bao quát
    `authorization:github:access_token:${token}`,
  ];

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8"/>
  <title>Hoàn tất đăng nhập</title>
  <meta name="robots" content="noindex"/>
  <style>
    body{font-family:system-ui;-webkit-font-smoothing:antialiased;margin:2rem;line-height:1.5}
    code,pre{background:#f6f8fa;padding:.75rem;border-radius:8px;display:block;overflow:auto}
  </style>
</head>
<body>
  <h1>Đăng nhập GitHub thành công</h1>
  <p>Đang gửi token về cửa sổ CMS (nhiều lần để đảm bảo nhận). Mở Console của trang <code>/admin</code> để quan sát.</p>

  <h3>origin</h3>
  <pre>${targetOrigin}</pre>

  <script>
    (function () {
      var origin = ${JSON.stringify(targetOrigin)};
      var msgs = ${JSON.stringify(formats)};
      var sendCount = 0;

      function sendOnce(useStar) {
        var tgt = useStar ? '*' : origin;
        var ok = false;
        function _send(target) {
          try {
            if (target && typeof target.postMessage === 'function') {
              for (var i=0; i<msgs.length; i++) { target.postMessage(msgs[i], tgt); }
              ok = true;
            }
          } catch (e) { console.error('postMessage error:', e); }
        }
        if (window.opener && !window.opener.closed) _send(window.opener);
        if (!ok && window.parent && window.parent !== window) _send(window.parent);
        return ok;
      }

      // Gửi lại nhiều lần trong ~6 giây:
      // - 6 lần đầu với origin chính xác
      // - 6 lần sau (nếu cần) với targetOrigin='*' để TEST listener
      var attempts = 0;
      var timer = setInterval(function(){
        attempts++;
        var useStar = attempts > 6;
        var ok = sendOnce(useStar);
        sendCount++;
        if (attempts >= 12) clearInterval(timer);
      }, 500);

      // KHÔNG tự đóng popup – để bạn kiểm tra trực tiếp.
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
