const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const { MockLanguageModelV3, convertArrayToReadableStream } = require('ai/test');
const ai = require('ai');

function setup({ session = true, failWrite = false } = {}) {
  const conversations = [], messages = [], cache = {};
  let dbCalls = 0;
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream([
    { type: 'stream-start', warnings: [] },
    { type: 'source', sourceType: 'url', id: 'source-1', url: 'https://example.org', title: 'Źródło' },
    { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: 'Odpowiedź testowa.' }, { type: 'text-end', id: 'answer' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
  ]) }) });
  const db = { from(table) {
    dbCalls++;
    return {
      insert(row) {
        if (table === 'conversations') return { select() { return { single: async () => { const id = conversations.length + 1; conversations.push({ id, ...row }); return { data: { id }, error: null }; } }; } };
        if (failWrite) return Promise.resolve({ error: { message: 'private database detail' } });
        messages.push({ id: messages.length + 1, ...row }); return Promise.resolve({ error: null });
      },
      select() { const list = { order() { return list; }, then(resolve, reject) { return Promise.resolve({ data: [...conversations].reverse(), error: null }).then(resolve, reject); }, eq(_field, id) {
        if (table === 'conversations') return { maybeSingle: async () => ({ data: conversations.find(item => item.id === id) ?? null, error: null }) };
        const builder = { order() { return builder; }, then(resolve, reject) { return Promise.resolve({ data: messages.filter(item => item.conversation_id === id), error: null }).then(resolve, reject); } };
        return builder;
      } }; return list; },
    };
  } };
  function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Response, Request, Buffer, URL, AbortController, AbortSignal, TransformStream, structuredClone, setTimeout, clearTimeout, Date, process: { env: { OPENROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'fake' } }, require(name) {
      if (name === 'server-only') return {};
      if (name.endsWith('/user-profile')) return { loadUserProfile: async () => ({ name: null, preferences: null }), saveUserProfile: async () => true };
      if (name.endsWith('/session')) return { hasSession: () => session, sameOrigin: () => true, privateHeaders: { 'Cache-Control': 'no-store' } };
      if (name.endsWith('/supabase')) return { getSupabase: () => db };
      if (name === 'ai') return { ...ai, generateImage: async () => ({ image: { base64: 'aW1hZ2U=', mediaType: 'image/png' }, responses: [{ modelId: 'fake/image' }] }) };
      if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => Object.assign(() => model, { imageModel: () => 'fake', tools: { webSearch: require('@openrouter/ai-sdk-provider').openrouter.tools.webSearch } }) };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      return require(name);
    } });
    return exports;
  }
  return { create: load('app/api/conversations/route.ts').POST, list: load('app/api/conversations/route.ts').GET, get: load('app/api/conversations/[id]/route.ts').GET, chat: load('app/api/chat/route.ts').POST, agent: load('app/api/agent/route.ts').POST, image: load('app/api/image/route.ts').POST, conversations, messages, model, dbCalls: () => dbCalls };
}
const req = (url, body) => new Request(`http://localhost${url}`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const getReq = id => new Request(`http://localhost/api/conversations/${id}`);
const params = id => ({ params: Promise.resolve({ id: String(id) }) });
const userMessage = text => ({ id: 'user-1', role: 'user', parts: [{ type: 'text', text }] });

for (const mode of ['chat', 'agent']) test(`${mode}: saves both messages and restores them after refresh`, async () => {
  const app = setup();
  const created = await app.create(req('/api/conversations')); assert.equal(created.status, 201);
  const { id } = await created.json();
  const sent = await app[mode](req(`/api/${mode}`, { conversationId: id, messages: [userMessage('Cześć')] }));
  assert.equal(sent.status, 200); const stream = await sent.text(); assert.match(stream, /\[DONE\]/);
  assert.equal(app.messages.length, 2); assert.equal(app.messages[0].role, 'user'); assert.equal(app.messages[1].role, 'assistant');
  const history = await app.get(getReq(id), params(id)); assert.equal(history.status, 200);
  const restored = await history.json();
  assert.equal(restored.id, id); assert.equal(restored.messages[0].parts[0].text, 'Cześć');
  assert.ok(restored.messages[1].parts.some(part => part.type === 'text' && part.text === 'Odpowiedź testowa.'));
  assert.ok(restored.messages[1].parts.some(part => part.type === 'source-url'));
  const start = stream.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(part => part.type === 'start');
  assert.ok(start.messageId); assert.equal(restored.messages[1].id, start.messageId);
  const prior = restored.messages.map(message => ({ ...message, parts: message.parts.filter(part => part.type === 'text' || (message.role === 'user' && part.type === 'file')) }));
  const next = { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Kontynuuj rozmowę' }] };
  const continued = await app[mode](req(`/api/${mode}`, { conversationId: id, messages: [...prior, next] }));
  assert.equal(continued.status, 200); await continued.text();
  assert.equal(app.conversations.length, 1); assert.equal(app.messages.length, 4);
  const reloaded = await (await app.get(getReq(id), params(id))).json();
  assert.equal(new Set(reloaded.messages.map(message => message.id)).size, 4);
  assert.ok(reloaded.messages.every(message => message.id));
  const modelInput = JSON.stringify(app.model.doStreamCalls[1].prompt);
  assert.match(modelInput, /Cześć/); assert.match(modelInput, /Odpowiedź testowa/); assert.match(modelInput, /Kontynuuj rozmowę/);
});

test('legacy missing and duplicate message ids are repaired without losing messages', async () => {
  const app = setup(); const { id } = await (await app.create(req('/api/conversations'))).json();
  const rows = [
    { id: '', role: 'assistant', parts: [{ type: 'text', text: 'Pierwsza' }] },
    { id: '', role: 'assistant', parts: [{ type: 'text', text: 'Druga' }] },
    { id: 'powtórzony', role: 'user', parts: [{ type: 'text', text: 'Trzecia' }] },
    { id: 'powtórzony', role: 'assistant', parts: [{ type: 'text', text: 'Czwarta' }] },
  ];
  rows.forEach((message, index) => app.messages.push({ id: index + 1, conversation_id: id, role: message.role, content: JSON.stringify(message) }));
  const first = await (await app.get(getReq(id), params(id))).json();
  const second = await (await app.get(getReq(id), params(id))).json();
  assert.equal(first.messages.length, 4);
  assert.deepEqual(first.messages.map(message => message.parts[0].text), ['Pierwsza', 'Druga', 'Trzecia', 'Czwarta']);
  assert.ok(first.messages.every(message => message.id));
  assert.equal(new Set(first.messages.map(message => message.id)).size, 4);
  assert.deepEqual(first.messages.map(message => message.id), second.messages.map(message => message.id));
});

test('history endpoints reject unauthenticated access before the database', async () => {
  const app = setup({ session: false });
  assert.equal((await app.create(req('/api/conversations'))).status, 401);
  assert.equal((await app.list(new Request('http://localhost/api/conversations'))).status, 401);
  assert.equal((await app.get(getReq(1), params(1))).status, 401);
  assert.equal((await app.chat(req('/api/chat', { conversationId: 1, messages: [userMessage('Cześć')] }))).status, 401);
  assert.equal(app.dbCalls(), 0); assert.equal(app.model.doStreamCalls.length, 0);
});

test('lists saved conversations with titles and dates', async () => {
  const app = setup();
  app.conversations.push({ id: 1, title: 'Pierwsza', created_at: '2026-01-01T10:00:00Z' }, { id: 2, title: 'Druga', created_at: '2026-01-02T10:00:00Z' });
  const response = await app.list(new Request('http://localhost/api/conversations'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.conversations.map(item => item.title), ['Druga', 'Pierwsza']);
  assert.equal(data.conversations[0].created_at, '2026-01-02T10:00:00Z');
});

test('database error blocks model and does not leak private details', async () => {
  const app = setup({ failWrite: true }); const { id } = await (await app.create(req('/api/conversations'))).json();
  const response = await app.chat(req('/api/chat', { conversationId: id, messages: [userMessage('Cześć')] }));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private database detail/); assert.equal(app.model.doStreamCalls.length, 0);
});

test('unknown or malformed conversation ids are rejected', async () => {
  const app = setup(); assert.equal((await app.get(getReq('abc'), params('abc'))).status, 400);
  assert.equal((await app.get(getReq(99), params(99))).status, 404);
});

test('generated image is included when the conversation is reloaded', async () => {
  const app = setup(); const { id } = await (await app.create(req('/api/conversations'))).json();
  const image = await app.image(req('/api/image', { conversationId: id, prompt: 'Rysunek kota' }));
  assert.equal(image.status, 200); assert.equal((await image.json()).historySaved, true);
  const history = await (await app.get(getReq(id), params(id))).json();
  assert.equal(history.messages.length, 1); assert.equal(history.messages[0].metadata.generatedImage, true);
  assert.equal(history.messages[0].parts[0].text, 'Rysunek kota');
  assert.match(history.messages[0].parts[1].url, /^data:image\/png;base64,/);
});
