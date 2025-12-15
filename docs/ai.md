# Tạo bài bằng AI (AI Post Generation)

Tính năng này cho phép tạo bản thảo bài viết bằng AI (OpenAI) và, nếu cấu hình token GitHub, sẽ tự động commit bài viết vào repository.

Env vars cần thiết (tuỳ chọn):

- `OPENAI_API_KEY` — (tuỳ chọn) OpenAI API key để tạo nội dung. Nếu không đặt, endpoint vẫn trả về nội dung mẫu.
- `AI_GITHUB_TOKEN` hoặc `GITHUB_TOKEN` — (tuỳ chọn) GitHub token có quyền `repo` để commit file mới trực tiếp vào repo. Nếu không có, API sẽ trả về nội dung để bạn sao chép dán thủ công.

Endpoint serverless:

- `POST /api/ai/generate`
  - body: `{ title: string, prompt?: string, commit?: boolean }`
  - response:
    - `{ ok: true, committed: true, path, html_url }` nếu đã commit thành công
    - `{ ok: true, committed: false, content }` nếu không commit (token không có hoặc commit=false)

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
