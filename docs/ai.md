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

- The server will prefer `OPENAI_API_KEY` for text and images (via OpenAI Images API). If you have `GENMINI_API_KEY` or `BINGAI_API_KEY` these env vars are accepted but provider-specific hooks are not implemented yet — they can be added later as needed.
