
// /api/oauth/callback.js (Vercel Serverless Function)
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const client_id     = process.env.OAUTH_CLIENT_ID;
  const client_secret = process.env.OAUTH_CLIENT_SECRET;
  const siteUrl       = process.env.SITE_URL;                 // ví dụ: https://blog.thien.ac
  const host          = process.env.OAUTH_HOSTNAME || 'github.com';

  // 0) Kiểm tra env
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

  // 1) Lấy code + state
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'MissingCode', message: 'OAuth "code" is required' });
  }

  // 2) Parse cookies an toàn
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(v => {
      const i = v.indexOf('=');
      if (i === -1) return [v.trim(), ''];
      const k = v.slice(0, i).trim();
      const val = v.slice(i + 1).trim();
      return [k, val];
    })
  );

  // origin: ưu tiên query, fallback cookie, cuối cùng SITE_URL
  let originFromCookie = '';
  try { originFromCookie = cookies['oauth_origin'] ? decodeURIComponent(cookies['oauth_origin']) : ''; } catch {}
  const originFromQuery = (req.query.origin && String(req.query.origin)) || '';
  const targetOrigin    = originFromQuery || originFromCookie || siteUrl;

  // 3) Xác thực CSRF state (khuyến nghị: chặn nếu mismatch)
  let savedState = '';
  try { savedState = cookies['oauth_state'] ? decodeURIComponent(cookies['oauth_state']) : ''; } catch {}
  if (!savedState || savedState !== state) {
    // Bật nới lỏng khi debug: chỉ cảnh báo thay vì chặn
    // console.warn('State mismatch:', { savedState, state });
    return res.status(400).json({ error: 'StateMismatch', savedState, state });
  }

  // 4) redirect_uri phải khớp với URL đã dùng ở bước authorize
  const redirect_uri = `${siteUrl}/api/oauth/callback?origin=${encodeURIComponent(targetOrigin)}`;

  // 5) Đổi code lấy access_token từ GitHub
  let tokenData;
  try {
    const params = new URLSearchParams({ client_id, client_secret, code, redirect_uri });

    const tokenResp = await fetch(`https://${host}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!tokenResp.ok) {
      const raw = await tokenResp.text().catch(() => '');
      return res.status(tokenResp.status).json({
        error: 'TokenExchangeFailed',
        status: tokenResp.status,
        body: raw,
      });
    }

    // Cố gắng parse JSON; nếu fail, fallback text để debug
    try {
      tokenData = await tokenResp.json();
    } catch {
      const raw = await tokenResp.text().catch(() => '');
      return res.status(502).json({ error: 'TokenParseFailed', body: raw });
    }
  } catch (e) {
    return res.status(502).json({ error: 'TokenExchangeError', message: e.message });
  }

  if (tokenData.error) {
    return res.status(400).json({ error: tokenData.error, description: tokenData.error_description });
  }

  const token = tokenData.access_token || tokenData.token;
  if (!token) {
    return res.status(400).json({ error: 'NoAccessToken', details: tokenData });
  }

  // 6) Các định dạng message Decap/Netlify có thể lắng nghe
  const jsonPayload = JSON.stringify({ token, provider: 'github', backend: 'github', state });
  const formats = [
    `authorization:github:success:${jsonPayload}`, // Decap v3 (phổ biến)
    `netlify-cms-oauth-provider:${jsonPayload}`,   // Netlify CMS provider cũ
    `authorization:github:success:${token}`,       // token chuỗi sau prefix
    `authorization:github:access_token:${token}`,  // biến thể ít gặp
  ];

  // 7) Trả về HTML, postMessage về đúng origin, gửi lặp để đảm bảo nhận
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
      var attempts = 0;

      function sendOnce() {
        var ok = false;
        function _send(target) {
          try {
            if (target && typeof target.postMessage === 'function') {
              for (var i=0; i<msgs.length; i++) { target.postMessage(msgs[i], origin); }
              ok = true;
            }
          } catch (e) { console.error('postMessage error:', e); }
        }
        if (window.opener && !window.opener.closed) _send(window.opener);
        if (!ok && window.parent && window.parent !== window) _send(window.parent);
        return ok;
      }

      // Gửi lại nhiều lần trong ~6 giây với origin CHÍNH XÁC
      var timer = setInterval(function(){
        attempts++;
        var ok = sendOnce();
        if (attempts >= 12) clearInterval(timer);
      }, 500);

      // Không tự đóng popup để bạn kiểm tra trực tiếp.
    })();
  </script>
  

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
