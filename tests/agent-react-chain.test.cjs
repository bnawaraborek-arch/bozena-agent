const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const ai = require('ai');
const { MockLanguageModelV3, convertArrayToReadableStream } = require('ai/test');
const { z } = require('zod');

function findValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  for (const nested of Object.values(value).reverse()) { const found = findValue(nested, key); if (found !== undefined) return found; }
}

test('actual agent passes mocked NBP rate to calculator and calculator result to notes', { timeout: 5000 }, async () => {
  const calls = [], apiRequests = [];
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let step = 0;
  const model = new MockLanguageModelV3({ doStream: async ({ prompt }) => {
    step++;
    let toolName, input;
    if (step === 1) { toolName = 'waluty'; input = { waluta: 'EUR', kwota: 1, kierunek: 'na_pln' }; }
    if (step === 2) { toolName = 'kalkulator'; input = { a: 1500, b: findValue(prompt, 'kurs'), dzialanie: 'dzielenie' }; }
    if (step === 3) { toolName = 'notatki'; input = { akcja: 'zapisz', tekst: `1500 PLN to ${findValue(prompt, 'wynik')} EUR` }; }
    const chunks = [{ type: 'stream-start', warnings: [] }];
    if (step <= 3) chunks.push({ type: 'tool-call', toolCallId: `call-${step}`, toolName, input: JSON.stringify(input) });
    else chunks.push({ type: 'text-start', id: 'final' }, { type: 'text-delta', id: 'final', delta: 'Gotowe.' }, { type: 'text-end', id: 'final' });
    chunks.push({ type: 'finish', finishReason: { unified: step <= 3 ? 'tool-calls' : 'stop', raw: step <= 3 ? 'tool-calls' : 'stop' }, usage });
    return { stream: convertArrayToReadableStream(chunks) };
  } });
  const cache = {};
  function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Response, Buffer, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout, Intl, Date, process: { env: { OPENROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'fake' } },
      fetch: async url => { apiRequests.push(url); return { ok: true, json: async () => ({ table: 'A', currency: 'euro', code: 'EUR', rates: [{ effectiveDate: '2026-11-23', mid: 4.25 }] }) }; },
      require(name) {
        if (name.endsWith('/user-profile')) return { loadUserProfile: async () => ({ name: null, preferences: null }), saveUserProfile: async () => true };
      if (name.endsWith('/session')) return { hasSession: () => true, sameOrigin: () => true, privateHeaders: {} };
        if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => Object.assign(() => model, { imageModel: () => 'fake', tools: { webSearch: () => ai.tool({ inputSchema: z.object({}), execute: async () => ({}) }) } }) };
        if (name.startsWith('.')) {
          const loaded = load(path.resolve(path.dirname(file), name) + '.ts');
          if (name.endsWith('/agent-tools')) return { ...loaded, createAgentTools: (...args) => {
            const tools = loaded.createAgentTools(...args);
            for (const name of ['waluty', 'kalkulator', 'notatki']) {
              const original = tools[name].execute;
              tools[name] = { ...tools[name], execute: async (input, options) => { const output = await original(input, options); calls.push({ name, input, output }); return output; } };
            }
            return tools;
          } };
          return loaded;
        }
        return require(name);
      } });
    return exports;
  }
  const request = new Request('http://localhost/api/agent', { method: 'POST', body: JSON.stringify({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Pobierz kurs EUR/PLN, przelicz 1500 PLN na EUR i zapisz wynik w notatce.' }] }] }) });
  const response = await load('app/api/agent/route.ts').POST(request);
  assert.equal(response.status, 200);
  const body = await response.text(); assert.match(body, /\[DONE\]/);
  assert.equal(model.doStreamCalls.length, 4);
  assert.deepEqual(calls.map(call => call.name), ['waluty', 'kalkulator', 'notatki']);
  assert.equal(apiRequests.length, 1); assert.match(apiRequests[0], /api\.nbp\.pl/);
  assert.equal(calls[1].input.b, calls[0].output.kurs);
  assert.equal(calls[1].output.wynik, 1500 / calls[0].output.kurs);
  assert.ok(calls[2].input.tekst.includes(String(calls[1].output.wynik)));
  assert.equal(calls[2].output.notatki[0].tekst, calls[2].input.tekst);
});
