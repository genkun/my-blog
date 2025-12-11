
// pages/api/env-check.js
export const config = { runtime: 'nodejs' };
export default function handler(req, res) {
  res.json({
    OAUTH_CLIENT_ID: !!process.env.OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET: !!process.env.OAUTH_CLIENT_SECRET,
    SITE_URL: process.env.SITE_URL,
  });
}
