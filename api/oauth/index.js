
// /api/oauth/index.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

/**
 * Tạo chuỗi state ngẫu nhiên, an toàn bằng Node crypto.
 */
function makeState(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex'); // 32 hex chars
}

export default async function handler(req, res) {
  try {
    // Env bắt buộc
    const siteUrl   = process.env.SITE_URL;             // ví dụ: https://blog.thien.ac
    const client_id = process.env.OAUTH_CLIENT_ID;
    const scope     = process.env.OAUTH_SCOPE || 'repo';
    const host      = process.env.OAUTH_HOSTNAME || 'github.com';

    if (!client_id || !siteUrl) {
      return res.status(500).json({
        error: 'MissingEnv',
        missing: { OAUTH_CLIENT_ID: !client_id, SITE_URL: !siteUrl }
      });
    }

    // origin thật của trang CMS: ưu tiên ?origin, fallback SITE_URL
    const origin = (req.query.origin && String(req.query.origin)) || siteUrl;

    // state cho CSRF
    const state = makeState(16);

    // Set cookie cho callback đối chiếu:
