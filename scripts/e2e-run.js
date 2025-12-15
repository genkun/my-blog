#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';

// Small test runner for AI endpoints. Mocks global.fetch and calls handlers directly.
import chatHandler from '../api/ai/chat.js';
import genHandler from '../api/ai/generate.js';

function makeRes() {
  let _status = 200; let _body = null;
  return {
    status(s) { _status = s; return this; },
    json(b) { _body = b; return Promise.resolve(b); },
    get _status() { return _status; },
    get _body() { return _body; }
  };
}

function makeReq(method, body) { return { method, body }; }

function mockFetchFactory(scenarios) {
  return async function mockFetch(url, opts) {
    // find matching scenario by predicate or url includes (also try decodeURIComponent)
    const uDec = (() => { try { return decodeURIComponent(url); } catch (e) { return url; } })();
    for (const s of scenarios) {
      try {
        if (s.match && s.match(url, opts)) return s.response(url, opts);
        if (s.match && s.match(uDec, opts)) return s.response(url, opts);
        if (s.url && (String(url).indexOf(s.url) !== -1 || String(uDec).indexOf(s.url) !== -1)) return s.response(url, opts);
      } catch (e) { /* ignore match function errors */ }
    }
    throw new Error('Unexpected fetch call: ' + url);
  };
}

async function run() {
  console.log('E2E test: starting');
  // Ensure we have API keys for handlers that check env vars (we mock fetch responses below)
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Test 1: chat success
  global.fetch = mockFetchFactory([
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hello from AI' } }] }) }) }
  ]);
  let res = makeRes();
  await chatHandler(makeReq('POST', { prompt: 'hi' }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.reply, 'Hello from AI');
  console.log('✓ chat success');

  // Test 2: chat upstream failure -> 502
  global.fetch = mockFetchFactory([
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: false, status: 500, json: async () => ({}) }) }
  ]);
  res = makeRes();
  await chatHandler(makeReq('POST', { prompt: 'hi' }), res);
  assert.strictEqual(res._status, 502);
  console.log('✓ chat upstream error handling');

  // Test 3: generate auto with compose JSON and no GH token -> committed false
  global.fetch = mockFetchFactory([
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'AutoTitle', description: 'desc', body: '# content', images: [{ prompt: 'img1' }] }) } }] }) }) }
  ]);
  res = makeRes();
  await genHandler(makeReq('POST', { auto: true, prompt: 'topic about test', commit: false }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, false);
  assert(res._body.generated && res._body.generated.title === 'AutoTitle');
  console.log('✓ generate auto returns generated payload without commit');

  // Test 4: generate auto with images + commit (mock GH API)
  global.fetch = mockFetchFactory([
    // compose
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'AutoWithImg', description: 'd', body: '# b', images: [{ prompt: 'a dog' }] }) } }] }) }) },
    // image generation
    { url: 'https://api.openai.com/v1/images/generations', response: () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'BASE64DATA' }] }) }) },
    // check file - return not found
    { match: (u) => u.indexOf('https://api.github.com/repos/') === 0 && u.indexOf('/contents/') !== -1 && u.indexOf('?ref=') !== -1, response: () => ({ ok: false, status: 404, json: async () => ({}) }) },
    // create image file
    { match: (u, o) => u.indexOf('https://api.github.com/repos/') === 0 && o && o.method === 'PUT' && u.indexOf('/public/assets/images/ai/') !== -1, response: () => ({ ok: true, status: 201, json: async () => ({ content: { path: 'public/assets/images/ai/auto-1.png', html_url: 'https://github' } }) }) },
    // create post file
    { match: (u, o) => u.indexOf('https://api.github.com/repos/') === 0 && o && o.method === 'PUT' && u.indexOf('/contents/src/content/posts') !== -1, response: () => ({ ok: true, status: 201, json: async () => ({ content: { path: 'src/content/posts/autowithimg.md', html_url: 'https://github' } }) }) }
  ]);
  process.env.AI_GITHUB_TOKEN = 'testtoken';
  res = makeRes();
  await genHandler(makeReq('POST', { auto: true, prompt: 'write about a dog', commit: true, imagesCount: 1 }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, true);
  console.log('✓ generate auto with images and commit');

  // Test 5: compose returns server error text (non-JSON), fallback to title+body
  global.fetch = mockFetchFactory([
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A server error occurred while composing' } }] }) }) },
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Generated fallback body content' } }] }) }) }
  ]);
  delete process.env.AI_GITHUB_TOKEN;
  res = makeRes();
  await genHandler(makeReq('POST', { auto: true, prompt: 'fallback test', commit: false }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, false);
  console.log('✓ fallback compose handled gracefully');

  // Test 6: AI_ADMIN_SECRET enforcement
  process.env.AI_ADMIN_SECRET = 'shh';
  res = makeRes();
  await genHandler(makeReq('POST', { auto: true, prompt: 'x', commit: false }), res);
  assert.strictEqual(res._status, 403);
  console.log('✓ admin secret enforced');

  // Test 9: /api/ai/chat without OPENAI_API_KEY -> 400 with helpful message
  delete process.env.OPENAI_API_KEY;
  // ensure admin secret not interfering with chat endpoint
  delete process.env.AI_ADMIN_SECRET;
  global.fetch = mockFetchFactory([]); // should not be called
  res = makeRes();
  // call chatHandler directly
  await chatHandler(makeReq('POST', { prompt: 'hello' }), res);
  assert.strictEqual(res._status, 400);
  assert.strictEqual(res._body.ok, false);
  assert.strictEqual(res._body.error, 'missing_api_key');
  console.log('✓ chat handler returns useful message when OPENAI_API_KEY missing');

  // Test 10: enable DEV_USE_FAKE_OPENAI and ensure chat/generate return mock responses
  process.env.DEV_USE_FAKE_OPENAI = '1';
  process.env.OPENAI_API_KEY = 'dev-key';
  global.fetch = mockFetchFactory([]);
  res = makeRes();
  await chatHandler(makeReq('POST', { prompt: 'xin chao' }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert(res._body.reply && res._body.reply.indexOf('DEV_MOCK') !== -1);
  console.log('✓ chat mock provider returns dev reply');

  // generate handler compose mock
  res = makeRes();
  await genHandler(makeReq('POST', { title: 'giáo trình tiếng trung cho người việt', prompt: 'viết nội dung ngắn', commit: false }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, false);
  // The dev mock includes 'DEV_MOCK' marker in the generated body
  assert(res._body.content && res._body.content.indexOf('DEV_MOCK') !== -1);
  console.log('✓ generate mock provider returns content (dev mock)');

  // Test 7: real-world scenario - generate with explicit Vietnamese title (no commit)
  delete process.env.AI_ADMIN_SECRET;
  global.fetch = mockFetchFactory([
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '# giáo trình tiếng trung cho người việt\n\nNội dung mẫu do AI tạo.' } }] }) }) }
  ]);
  res = makeRes();
  await genHandler(makeReq('POST', { title: 'giáo trình tiếng trung cho người việt', prompt: 'viết một giáo trình ngắn cho người mới bắt đầu', commit: false }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, false);
  assert(res._body.content && res._body.content.indexOf('giáo trình tiếng trung cho người việt') !== -1);
  console.log('✓ scenario: generate Vietnamese title (no commit)');

  // Test 8: same scenario but with commit (mock GH API)
  global.fetch = mockFetchFactory([
    // body generation
    { url: 'https://api.openai.com/v1/chat/completions', response: () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '# giáo trình tiếng trung cho người việt\n\nNội dung đầy đủ.' } }] }) }) },
    // check file - not found
    { match: (u) => u.indexOf('https://api.github.com/repos/') === 0 && u.indexOf('/contents/') !== -1 && u.indexOf('?ref=') !== -1, response: () => ({ ok: false, status: 404, json: async () => ({}) }) },
    // create post file
    { match: (u, o) => u.indexOf('https://api.github.com/repos/') === 0 && o && o.method === 'PUT' && u.indexOf('/contents/src/content/posts') !== -1, response: () => ({ ok: true, status: 201, json: async () => ({ content: { path: 'src/content/posts/giao-trinh-tieng-trung-cho-nguoi-viet.md', html_url: 'https://github' } }) }) }
  ]);
  process.env.AI_GITHUB_TOKEN = 'testtoken';
  res = makeRes();
  await genHandler(makeReq('POST', { title: 'giáo trình tiếng trung cho người việt', prompt: 'viết một giáo trình ngắn cho người mới bắt đầu', commit: true }), res);
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body.ok, true);
  assert.strictEqual(res._body.committed, true);
  assert.strictEqual(res._body.slug, 'giao-trinh-tieng-trung-cho-nguoi-viet');
  console.log('✓ scenario: generate Vietnamese title (with commit)');

  console.log('All E2E tests passed');
}

run().catch(err => { console.error('E2E tests failed', err); process.exit(1); });
