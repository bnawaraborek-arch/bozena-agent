const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup(timers = { setTimeout, clearTimeout }) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('lib/agent-limits.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, AbortController, AbortSignal, ...timers });
  return exports;
}

test('at most sixteen local tool calls execute, including parallel calls', async () => {
  const { createToolGuard, TOOL_LIMIT } = setup(); assert.equal(TOOL_LIMIT, 16);
  let executions = 0;
  const guard = createToolGuard();
  const tools = guard.wrap({ kalkulator: { execute: async () => { executions++; return { ok: true }; } } });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => tools.kalkulator.execute({ i }, {})));
  assert.equal(executions, 16); assert.equal(guard.calls, 16);
  assert.equal(results.filter(result => result.ok).length, 16);
  assert.match(results[16].blad, /limit 16/);
});

test('external tool stops at ten seconds and reports source timeout', async () => {
  let delay;
  const { createToolGuard, API_TIMEOUT_MS, TASK_TIMEOUT_MS } = setup({ setTimeout: (fn, ms) => { delay = ms; queueMicrotask(fn); return 1; }, clearTimeout: () => {} });
  assert.equal(API_TIMEOUT_MS, 10000); assert.equal(TASK_TIMEOUT_MS, 60000);
  const guarded = createToolGuard().wrap({ pogoda: { execute: () => new Promise(() => {}) } });
  const result = await guarded.pogoda.execute({}, {});
  assert.equal(delay, 10000); assert.equal(result.blad, 'Źródło nie odpowiada');
});

test('failed tool call is not retried with identical arguments', async () => {
  const { createToolGuard } = setup(); let executions = 0;
  const guarded = createToolGuard().wrap({ kalkulator: { execute: async () => { executions++; return { ok: false, blad: 'Nie udało się obliczyć.' }; } } });
  assert.equal((await guarded.kalkulator.execute({ a: 1 }, {})).ok, false);
  assert.match((await guarded.kalkulator.execute({ a: 1 }, {})).blad, /Nie ponowiono/);
  assert.equal(executions, 1);
});

test('SDK total deadline aborts a stalled model without waiting for real 60 seconds', { timeout: 3000 }, async () => {
  const { streamText } = require('ai');
  const { MockLanguageModelV3 } = require('ai/test');
  const model = new MockLanguageModelV3({ doStream: async ({ abortSignal }) => {
    await new Promise((resolve, reject) => {
      if (abortSignal.aborted) return reject(abortSignal.reason);
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    });
    throw Error('Model should have been interrupted');
  } });
  const events = [];
  const result = streamText({ model, prompt: 'test', maxRetries: 0, timeout: { totalMs: 25 } });
  for await (const part of result.fullStream) events.push(part.type);
  assert.ok(events.includes('abort'));
  assert.equal(model.doStreamCalls.length, 1);
});
