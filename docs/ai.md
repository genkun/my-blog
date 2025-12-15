# Tạo bài bằng AI (AI Post Generation)

Tính năng này cho phép tạo bản thảo bài viết bằng AI (OpenAI) và, nếu cấu hình token GitHub, sẽ tự động commit bài viết vào repository.

Env vars cần thiết (tuỳ chọn):

- `OPENAI_API_KEY` — (tuỳ chọn) OpenAI API key để tạo nội dung.
- `OPENAI_MODEL` — (tuỳ chọn) model mặc định cho OpenAI (ví dụ `gpt-4o-mini`).
- `GENMINI_API_KEY` — (tuỳ chọn) khóa cho GenMini để tạo hình ảnh (nếu bạn có).
- `BINGAI_API_KEY` — (tuỳ chọn) khóa cho Bing AI (nếu bạn có).
- `AI_GITHUB_TOKEN` hoặc `GITHUB_TOKEN` — (tuỳ chọn) GitHub token có quyền `repo` để commit file mới trực tiếp vào repo. Nếu không có, API sẽ trả về nội dung để bạn sao chép dán thủ công.

Endpoint serverless:

- `POST /api/ai/generate`
  - body: `{ title?: string, prompt?: string, commit?: boolean, auto?: boolean, imagesCount?: number }`
  - Notes:
    - If `auto=true` or no `title` provided, the server will ask the AI to craft a full post (title, description, body, image prompts).
    - `imagesCount` controls how many images to generate (default 2).
  - response:
    - `{ ok: true, committed: true, path, html_url }` nếu đã commit thành công
    - `{ ok: true, committed: false, content }` nếu không commit (token không có hoặc commit=false)
    - `{ ok: true, generated, images }` additional metadata when using `auto=true`

Example CURL (auto generate):

```bash
curl -X POST https://<your-site>/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"auto":true, "prompt":"Viết một bài hướng dẫn về cách tối ưu bài blog cho SEO"}'
```


Hành vi client (Admin UI):

- Trong trang `/admin` có nút "Tạo bài bằng AI".
- Khi bấm, nhập tiêu đề (bắt buộc) và mô tả/gợi ý (tuỳ chọn).
- Nếu máy chủ có `AI_GITHUB_TOKEN`, bài viết sẽ được commit với `draft: true` và trang sẽ reload để CMS có thể nhận file mới.
- Nếu không có token, nội dung sẽ được sao chép vào clipboard để bạn dán vào bài mới trong Admin.

Bảo mật

- Tránh đặt khóa OpenAI vào client — phải đặt trên môi trường server (Vercel/Netlify/Render). Endpoint server sẽ gọi OpenAI và commit bằng token server-side.

Gợi ý cải tiến

- Thêm UI modal để chỉnh frontmatter trước khi commit.
- Thêm tích hợp với editor để mở bài mới sau khi tạo (ví dụ chuyển tới `#/collections/blog/new?slug=...` nếu Decap hỗ trợ truyền nội dung khởi tạo).

Notes on providers

- Provider priority: prefer `OPENAI_API_KEY` (text + images). If not available, the server will fall back to `BINGAI_API_KEY` for text and `GENMINI_API_KEY` for images when configured. GitHub Copilot/other providers are not directly integrated yet.
- `AI_ADMIN_SECRET` — (tuỳ chọn) If set, requests to `/api/ai/generate` must include `{ secret: '<value>' }` in the JSON body to be allowed. This helps prevent public abuse.

Cài đặt `OPENAI_API_KEY`

- Trên môi trường production (Vercel / Netlify / Render / Fly): thêm biến môi trường `OPENAI_API_KEY` trong dashboard hosting với giá trị là OpenAI API key của bạn. Tên biến phải chính xác là `OPENAI_API_KEY`.

- Ví dụ:
  - Vercel: Project → Settings → Environment Variables → tạo `OPENAI_API_KEY`.
  - Netlify: Site settings → Build & deploy → Environment → thêm `OPENAI_API_KEY`.
  - GitHub Actions: thêm `OPENAI_API_KEY` vào `Secrets` của repository và truyền vào workflow nếu cần.

Chạy local (phát triển)

- Để phát triển mà không có API key thật, bạn có thể bật mock provider:
  - Thêm `DEV_USE_FAKE_OPENAI=1` vào file `.env.local` hoặc chạy `scripts/enable-dev-openai.sh` (sẽ tạo `.env.local` với `DEV_USE_FAKE_OPENAI=1` và `OPENAI_API_KEY=dev-key`).
  - Lưu ý: `dev-key` chỉ dành cho phát triển cục bộ — không dùng trong production.
  - Ngoài ra, admin UI có nút "Mock AI" (chỉ dành cho môi trường dev) để ép server trả kết quả giả (mock) cho mục đích thử nghiệm. Nút này chỉ gởi một cờ đến server và chỉ được chấp nhận khi server chạy ở chế độ không phải production.

Xử lý lỗi

- Nếu server chưa cấu hình `OPENAI_API_KEY`, endpoint `/api/ai/generate` hoặc `/api/ai/chat` sẽ trả lỗi `missing_api_key`. Kiểm tra hướng dẫn ở trên để cấu hình biến môi trường hoặc bật chế độ phát triển.

AI-generated posts

- Bây giờ khi máy chủ commit bài viết được tạo bởi AI, server sẽ đảm bảo file được lưu trong `src/content/posts/<slug>.md` với frontmatter đầy đủ cho Decap CMS (`title`, `description`, `published`, `updated`, `image`, `tags`, `category`, `author`, `slug`, `draft`, `lang`, `canonical`) để bài vừa tạo có thể hiển thị đúng trong Admin → New Post.

- Khi server commit thành công (ví dụ `commit: true` hoặc `auto` generation), bài viết sẽ được "publish now": `draft: false` và `published` được đặt theo ngày hiện tại, do đó bài sẽ xuất hiện ngay trong **Collections** của Decap CMS.
- Lưu ý: mặc định `commit` là `true` trong endpoint, tức là nếu bạn không chọn hủy commit (hoặc gọi với `commit: false`), bài sẽ được commit và publish tự động.

Thao tác "Thực thi" trong Chat AI

- Trong modal Chat AI có **Publish trực tiếp** (Publish trực tiếp) — một toggle lưu trong `localStorage`. Khi bật, nút **Thực thi** sẽ publish bài ngay lập tức (gửi `commit: true` tới server) và sẽ không hiện hộp thoại xác nhận ("không cần hỏi"). Mặc định toggle này được bật để thuận tiện; bạn có thể tắt nếu muốn lưu bản nháp thay vì publish.
- Nếu toggle tắt, hành vi cũ vẫn giữ: **Thực thi** sẽ tạo bản nháp (commit=false) và cố gắng sao chép nội dung vào clipboard, đồng thời hiển thị **Trạng thái** trong modal.
- Nếu bạn muốn publish tự động từ Chat, hãy dùng nút "Tạo AI (Auto)" hoặc gọi `/api/ai/generate` với `commit: true` (hoặc thay đổi hành vi này nếu cần). Việc mặc định lưu bản nháp giúp tránh publish vô ý.

Tự động triển khai (Deploy)

- Nếu bạn lưu trang trên một nền tảng như Vercel, commit lên `main` thường sẽ bắt đầu quá trình build & deploy tự động. Để chủ động kích hoạt một webhook deploy ngay khi post được commit, bạn có thể cấu hình biến môi trường `VERCEL_DEPLOY_HOOK` (hoặc `DEPLOY_HOOK`) với URL webhook do Vercel/Netlify/GitHub cung cấp. Server sẽ POST một payload nhỏ `{ source: 'ai-generate', path, slug }` tới URL đó khi một bài được commit.
- Sau khi commit thành công, Admin UI sẽ hiển thị thông báo nếu deploy hook được kích hoạt. Build có thể mất vài phút tùy dịch vụ.
