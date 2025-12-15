// /api/ai/chat.js
export const config = { runtime: 'nodejs' };

// Use global fetch when available; fall back to node-fetch dynamically if not present

async function callOpenAI(messages, model) {
  const key = process.env.OPENAI_API_KEY;
  // In local development you can enable the fake provider by setting DEV_USE_FAKE_OPENAI=1
  if (!key || key === 'dev-key') {
    if (process.env.DEV_USE_FAKE_OPENAI === '1' || process.env.OPENAI_API_KEY === 'dev-key') {
      const mock = await import('./mock.js');
      return mock.chatReply(messages, model);
    }
    throw new Error('OPENAI_API_KEY not set. Set OPENAI_API_KEY on the server to use chat features.');
  }
  const fetchFn = globalThis.fetch || (await import('node-fetch')).then(m => m.default);
  const resp = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, max_tokens: 1200 })
  });
  const json = await resp.json();
  if (!json || !json.choices || !json.choices[0] || !json.choices[0].message) {
    throw new Error('OpenAI response malformed');
  }
  return json.choices[0].message.content;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'MethodNotAllowed' });
    const { messages, prompt, secret, mode } = req.body || {};

    // optional server-side guard
    if (process.env.AI_ADMIN_SECRET) {
      if (!secret || secret !== process.env.AI_ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' });
    }

    // Accept either an array of messages or a single prompt
    let msgs = messages;
    if (!msgs || !Array.isArray(msgs)) {
      if (!prompt) return res.status(400).json({ error: 'missing_prompt' });
      msgs = [{ role: 'user', content: prompt }];
    }

    // If mode === 'compose_post', use a stricter system to return JSON for post composition
    if (mode === 'compose_post') {
      const system = `You are an assistant that outputs a single JSON object describing a complete blog post. Return strict JSON only. Schema: {title, description, body, images: [{prompt, filename_hint}], videos: [{url, caption}] }`;
      msgs = [{ role: 'system', content: system }].concat(msgs);
    }

    let reply;
    try {
      reply = await callOpenAI(msgs, process.env.OPENAI_MODEL);
    } catch (e) {
      console.error('OpenAI call failed in /api/ai/chat', e && (e.message || e));
      // If missing API key, return a 400 so the client can show actionable guidance.
      if (String(e.message || e).indexOf('OPENAI_API_KEY') !== -1) {
        return res.status(400).json({ ok: false, error: 'missing_api_key', message: String(e.message || e) });
      }
      return res.status(502).json({ ok: false, error: 'upstream_error', message: e.message || String(e) });
    }
    return res.json({ ok: true, reply });
  } catch (err) {
    console.error('ai/chat error', err && (err.stack || err.message || err));
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
}
