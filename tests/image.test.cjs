const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup({ session = true, failSave = false, generate = async () => ({ image: { base64: 'aW1hZ2U=', mediaType: 'image/png' }, responses: [{ modelId: 'provider/actual-image' }] }) } = {}) {
  const exports = {}; let calls = 0; const saved = [];
  const source = ts.transpileModule(fs.readFileSync('app/api/image/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, Response, process: { env: { OPENROUTER_API_KEY: 'fake' } }, require(name) {
    if (name.endsWith('/session')) return { hasSession: () => session, sameOrigin: () => true, privateHeaders: {} };
    if (name.endsWith('/conversation-store')) return { conversationId: value => Number.isSafeInteger(value) && value > 0 ? value : null, saveMessage: async (id, message) => { if (failSave) throw Error('private'); saved.push({ id, message }); } };
    if (name === 'ai') return { generateId: () => 'image-id', generateImage: async options => { calls++; assert.equal(options.model, 'google/gemini-3.1-flash-image-preview'); return generate(options); } };
    if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => ({ imageModel: id => id }) };
    throw new Error('Unexpected import');
  } });
  return { post: exports.POST, calls: () => calls, saved };
}
const req = prompt => new Request('http://localhost/api/image', { method: 'POST', body: JSON.stringify({ prompt }) });

test('image endpoint requires a session before generation', async () => {
  const app = setup({ session: false }); assert.equal((await app.post(req('kot'))).status, 401); assert.equal(app.calls(), 0);
});
test('image endpoint validates prompt and returns image and actual model metadata', async () => {
  const app = setup(); assert.equal((await app.post(req('x'.repeat(501)))).status, 400); assert.equal(app.calls(), 0);
  const response = await app.post(req('kot')); assert.equal(response.status, 200);
  const result = await response.json(); assert.match(result.url, /^data:image\/png;base64,/); assert.equal(result.modelId, 'provider/actual-image');
});
test('image endpoint reports provider errors and missing images', async () => {
  for (const generate of [async () => { throw new Error('private'); }, async () => ({ image: null, responses: [] })]) {
    const app = setup({ generate }); const response = await app.post(req('kot')); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /private/);
  }
});
test('generated image is saved in the selected conversation and reports save failures', async () => {
  for (const failSave of [false, true]) {
    const app = setup({ failSave });
    const response = await app.post(new Request('http://localhost/api/image', { method: 'POST', body: JSON.stringify({ prompt: 'kot', conversationId: 7 }) }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.historySaved, !failSave); assert.match(result.url, /^data:image\/png;base64,/);
    if (!failSave) { assert.equal(app.saved[0].id, 7); assert.equal(app.saved[0].message.metadata.generatedImage, true); assert.equal(app.saved[0].message.parts[1].url, result.url); }
  }
});
