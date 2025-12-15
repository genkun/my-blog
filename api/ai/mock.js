export function chatReply(messages, model) {
  // Return a simple echo-like reply for dev convenience
  const last = (messages && messages.length) ? messages[messages.length-1].content : 'Hello';
  return `DEV_MOCK: Tôi đã nhận: "${String(last).slice(0,200)}"`;
}

export async function composePost(opts = {}) {
  const title = opts.prompt ? (opts.prompt.slice(0,60) + '') : 'Bài viết mẫu từ DEV_MOCK';
  return {
    title: title || 'Bài viết mẫu từ DEV_MOCK',
    description: 'Mô tả ngắn (dev mock)',
    body: `# ${title}\n\nĐây là nội dung mẫu do môi trường phát triển (mock) tạo ra. Thay đổi khi bạn cần.`,
    images: [{ prompt: 'A simple illustrative image for dev', filename_hint: 'dev-img' }]
  };
}

export function simpleGenerate(prompt, title) {
  const t = title || (prompt && prompt.split('\n')[0]) || 'Bài viết mẫu từ DEV_MOCK';
  return `# ${t}\n\nNội dung được tạo bởi DEV_MOCK cho prompt: ${String(prompt).slice(0,200)}`;
}

export async function generateTitle(prompt) {
  if (!prompt) return 'Tiêu đề mẫu (dev)';
  const words = prompt.split(/[\s,\.]+/).slice(0,6).join(' ');
  return `${words}`.slice(0,50);
}

export async function generateImage(prompt) {
  // Return a small transparent png base64 to simulate image generation
  // 1x1 transparent png
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  return b64;
}
