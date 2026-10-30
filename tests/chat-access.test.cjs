const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

// Nie uruchamiamy Next.js ani ładowania plików .env. OpenRouter jest atrapą.
function setup(configured = true) {
  let calls = 0;
  let now = 1_000;
  const source = fs.readFileSync('app/api/chat/route.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  const context = {
    exports, Response, Date: { now: () => now },
    process: { env: configured ? {
      CHAT_ACCESS_CODE: 'temporary-test-code',
      OPENROUTER_API_KEY: 'fake-test-key', OPENROUTER_MODEL: 'fake-test-model',
    } : {} },
    require(name) {
      if (name === '@openrouter/ai-sdk-provider') return {
        createOpenRouter: () => { calls++; return () => ({}); },
      };
      if (name === 'ai') return {
        validateUIMessages: require('ai').validateUIMessages,
        convertToModelMessages: require('ai').convertToModelMessages,
        streamText: () => ({ toUIMessageStreamResponse: () => new Response('mock stream') }),
      };
      if (name === 'node:crypto') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
    fetch() { throw new Error('Network forbidden in tests'); },
  };
  vm.runInNewContext(compiled, context);
  return {
    calls: () => calls,
    advance: () => { now += 60_001; },
    post: (code, messages = []) => exports.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(code === undefined ? {} : { 'X-Chat-Access-Code': code }) },
      body: JSON.stringify({ messages }),
    })),
  };
}

const valid = [{ id: 'test', role: 'user', parts: [{ type: 'text', text: 'Cześć' }] }];

test('brak i błędny kod dają 401 przed OpenRouter, także przy poprawnej wiadomości', async () => {
  const app = setup();
  assert.equal((await app.post(undefined, valid)).status, 401);
  assert.equal((await app.post('wrong', valid)).status, 401);
  assert.equal(app.calls(), 0);
});

test('poprawny kod przechodzi do walidacji: pusta historia i pusty tekst dają 400', async () => {
  const app = setup();
  assert.equal((await app.post('temporary-test-code')).status, 400);
  assert.equal((await app.post('temporary-test-code', [
    { id: 'test', role: 'user', parts: [{ type: 'text', text: '   ' }] },
  ])).status, 400);
  assert.equal(app.calls(), 0);
});

test('poprawny kod i wiadomość dochodzą do atrapy streamingu', async () => {
  const app = setup();
  const response = await app.post('temporary-test-code', valid);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'mock stream');
  assert.equal(app.calls(), 1);
});

test('brak konfiguracji kodu zamyka dostęp', async () => {
  const app = setup(false);
  assert.equal((await app.post('temporary-test-code', valid)).status, 401);
  assert.equal(app.calls(), 0);
});

test('10 błędnych prób blokuje weryfikację do końca minuty', async () => {
  const app = setup();
  for (let i = 0; i < 10; i++) assert.equal((await app.post('wrong')).status, 401);
  const blocked = await app.post('temporary-test-code', valid);
  assert.equal(blocked.status, 401);
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  assert.equal(app.calls(), 0);
  app.advance();
  assert.equal((await app.post('temporary-test-code')).status, 400);
});
