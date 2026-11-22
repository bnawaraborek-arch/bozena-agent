const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const ai = require('ai');
const { test } = require('node:test');

function setup({ session = true, generate = async () => ({ image: { base64: 'aW1hZ2U=', mediaType: 'image/png' }, responses: [{ modelId: 'actual/model' }] }) } = {}) {
  let options, calls = 0;
  const cache = {};
  function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports, Response, Buffer, process: { env: { OPENROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'fake' } }, require(name) {
      if (name.endsWith('/session')) return { hasSession: () => session, sameOrigin: () => true, privateHeaders: {} };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => Object.assign(id => ({ id }), { imageModel: id => id, tools: { webSearch: args => args } }) };
      if (name === 'ai') return { ...ai, generateImage: generate, streamText: opts => { calls++; options = opts; return { toUIMessageStreamResponse: () => new Response('stream') }; } };
      return require(name);
    } });
    return exports;
  }
  return { post: load('app/api/agent/route.ts').POST, options: () => options, calls: () => calls };
}
const req = parts => new Request('http://localhost/api/agent', { method: 'POST', body: JSON.stringify({ messages: [{ id: '1', role: 'user', parts }] }) });
const text = [{ type: 'text', text: 'Zadanie' }];

test('agent requires session and rejects invalid images before model', async () => {
  const denied = setup({ session: false }); assert.equal((await denied.post(req(text))).status, 401); assert.equal(denied.calls(), 0);
  const app = setup(); assert.equal((await app.post(req([...text, { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,YWJj' }]))).status, 400); assert.equal(app.calls(), 0);
});
test('agent offers search and image tools and chooses vision-capable model for photos', async () => {
  const app = setup(); const photo = { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' };
  assert.equal((await app.post(req([...text, photo]))).status, 200);
  const opts = app.options(); assert.equal(opts.model.id, 'google/gemini-3.8-flash'); assert.equal(opts.tools.web_search.engine, 'native'); assert.equal(opts.tools.web_search.maxResults, 3);
  const image = await opts.tools.generate_image.execute({ prompt: 'kot' }, { toolCallId: 'test', messages: [] });
  assert.equal(image.ok, true); assert.equal(image.modelId, 'actual/model'); assert.match(image.url, /^data:image\/png;base64,/);
  assert.doesNotMatch(JSON.stringify(opts.tools.generate_image.toModelOutput({ output: image })), /aW1hZ2U=/);
});
test('agent image tool reports failure without inventing an image', async () => {
  const app = setup({ generate: async () => { throw new Error('provider private'); } }); await app.post(req(text));
  const output = await app.options().tools.generate_image.execute({ prompt: 'kot' }, { toolCallId: 'test', messages: [] });
  assert.equal(output.ok, false); assert.equal(output.url, undefined); assert.doesNotMatch(output.error, /private/);
});
