# Kết nối Decap CMS (Admin) với GitHub OAuth

Hướng dẫn cấu hình GitHub OAuth để đăng nhập vào phần quản trị (Decap CMS) của dự án.

1) Tạo OAuth App trên GitHub
- Vào GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
- Application name: (ví dụ) `My Blog Admin`.
- Homepage URL: `SITE_URL` (ví dụ `https://blog.thien.ac` hoặc `http://localhost:3000` khi local).
- Authorization callback URL: `${SITE_URL}/api/oauth/callback` (ví dụ `https://blog.thien.ac/api/oauth/callback`).
- Tạo app và ghi lại `Client ID` và `Client Secret`.

2) Thiết lập biến môi trường
- Đặt các biến môi trường sau trên hosting của bạn (Vercel/Netlify/Render/...) trong phần Environment Variables:
  - `OAUTH_CLIENT_ID` = (Client ID từ GitHub)
  - `OAUTH_CLIENT_SECRET` = (Client Secret từ GitHub)
  - `SITE_URL` = `https://your-site.example` (base URL của trang, KHÔNG có `/` cuối)
  - (tuỳ chọn) `OAUTH_HOSTNAME` = `github.com` (dùng nếu GitHub Enterprise khác hostname)

- Lưu ý: `public/admin/config.yml` đang dùng `${OAUTH_CLIENT_ID}` cho `auth.client_id`, vì vậy bạn cần rebuild site sau khi đặt biến (hoặc đảm bảo hệ thống deploy của bạn thay thế biến vào file public).

3) Thử nghiệm local
- Khi phát triển local, khởi chạy dev server:

```bash
pnpm i
pnpm dev
```

- Cách cung cấp biến môi trường cho local (tạm thời):

```bash
export OAUTH_CLIENT_ID=... \
export OAUTH_CLIENT_SECRET=... \
export SITE_URL=http://localhost:3000
pnpm dev
```

- Lưu ý về cookie Secure flag: API `/api/oauth` mặc định chỉ thêm `Secure` nếu `SITE_URL` bắt đầu bằng `https://`. Khi dùng `http://localhost` cookie vẫn được gửi (không có `Secure`) để tiện chạy local.

6) Popup và postMessage
- Khi mở popup để đăng nhập OAuth, popup phải giữ `window.opener` để có thể gọi `postMessage` về cửa sổ gốc. Vì vậy, gọi `window.open()` *không* được truyền các tính năng `noopener` hoặc `noreferrer` (một số site thêm mặc định; nếu bạn thấy popup không gửi token về, kiểm tra chỗ gọi `window.open`).

Ví dụ (trong `public/admin/index.html`):

```js
// ✅ giữ window.opener
window.open(url, 'github_oauth', 'width=800,height=700');

// ❌ KHÔNG dùng: 'width=800,height=700,noopener,noreferrer'
```

4) Tra cứu & kiểm tra
- Mở `/admin` và bấm **Đăng nhập GitHub**.
- Popup sẽ mở `/api/oauth/index` → chuyển hướng tới GitHub → sau khi xác thực sẽ trả về `/api/oauth/callback` và gửi token về trang `/admin` bằng `postMessage`.
- Nếu được, Decap CMS sẽ nhận payload và bạn sẽ vào dashboard.

5) Gợi ý bảo mật & triển khai
- Làm mới `OAUTH_CLIENT_SECRET` nếu nghi ngờ lộ.
- Đảm bảo `SITE_URL` chính xác và callback URL khớp với cấu hình trên GitHub OAuth App.
- Trên nền tảng deploy (Vercel/Netlify), thêm biến môi trường cho cả Production và Preview (và Development nếu muốn).

7) Troubleshooting — nếu không thấy UI để tạo/đăng bài sau khi đăng nhập

- Mở DevTools Console trên trang `/admin` trước khi click **Login with GitHub** và quan sát các log sau khi callback chạy:
  - `[OAuth] message received from ...` — tin nhắn từ popup
  - `[OAuth] Received token ...` hoặc `[OAuth] Sending payload to CMS.authCallback` — token/payload đã được nhận

- Kiểm tra `localStorage` trong Console:
  - `localStorage.getItem('decap_token')` — phải có token chuỗi
  - `localStorage.getItem('decap_oauth_payload')` — payload JSON nếu CMS chưa sẵn sàng

- Nếu không thấy log gì từ popup:
  - Kiểm tra popup có thực sự gọi `postMessage` (xem Console của popup).
  - Đảm bảo `window.open()` không dùng `noopener,noreferrer` (xem `public/admin/index.html`).

- Nếu token có nhưng CMS vẫn không hiện collections:
  - Kiểm tra file `/admin/config.yml` có `backend.repo` đúng và `auth.client_id` đã chứa giá trị thực (không phải `${OAUTH_CLIENT_ID}` literal) trên môi trường deploy.
  - Kiểm tra token có đủ scope (`repo`) và user có quyền ghi vào repo (branch, collaborator, app installation).

— Kiểm tra quyền token bằng GitHub API

1. Mở Console trên trang `/admin` và lấy token:

```js
var token = localStorage.getItem('decap_token');
console.log(token);
```

2. Kiểm tra thông tin user (nếu token hợp lệ, trả về user object):

```js
fetch('https://api.github.com/user', { headers: { Authorization: 'token ' + token } })
  .then(r => r.json()).then(console.log).catch(console.error);
```

3. Kiểm tra repo access:

```js
fetch('https://api.github.com/repos/<OWNER>/<REPO>', { headers: { Authorization: 'token ' + token } })
  .then(r => r.json()).then(console.log).catch(console.error);
```

Nếu API trả lỗi 401/403, token không có quyền hoặc đã hết hạn. Hãy đảm bảo `scope` bao gồm `repo` và user hoặc app có quyền ghi vào repo.

Direct publish (tự động commit)

- Nếu bạn muốn phần quản trị tự động commit và publish bài viết (không tạo Pull Request), đặt `publish_mode: simple` trong `public/admin/config.yml`.
- Với chế độ `simple`, việc publish trong admin sẽ tạo commit thẳng lên nhánh cấu hình (mặc định `main`). Hãy chắc chắn token OAuth có `repo` scope và user/app có quyền ghi vào repo.
- Nếu bạn muốn quy trình review + merge, giữ `publish_mode: editorial_workflow` để CMS tạo Pull Request thay vì commit trực tiếp.

- Các lỗi phổ biến: origin mismatch (callback gửi tới origin A nhưng admin đang mở origin B), cookie `oauth_state` bị mất (CSRF state mismatch), hoặc `OAUTH_CLIENT_ID/SECRET` chưa đặt đúng trên host.

Nếu bạn muốn, tôi có thể:
- Thêm temporal debug UI (nút hiện `localStorage`/cookie) hoặc tạm thời log thêm thông tin trong `/api/oauth/callback` để xác định origin và body được gửi đi.
- Giúp kiểm tra quyền token bằng gọi API GitHub (ví dụ `GET https://api.github.com/user` với `Authorization: token <token>`).

Nếu bạn muốn, mình có thể giúp tạo `.env.example`, cập nhật README và kiểm tra quy trình đăng nhập trên môi trường local hoặc deploy preview của bạn.