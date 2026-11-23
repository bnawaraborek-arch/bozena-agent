const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');
const ai = require('ai');
const { MockLanguageModelV3, convertArrayToReadableStream } = require('ai/test');
const { z } = require('zod');

function loadProgress() {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/agent-progress.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require });
  return exports.AgentProgress;
}

test('real agent stream stops at two mocked steps, preserves results and completes', { timeout: 5000 }, async () => {
  const executed = [];
  let callNumber = 0;
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const model = new MockLanguageModelV3({ doStream: async () => {
    callNumber++;
    const toolName = ['waluty', 'kalkulator', 'dodatkowe'][callNumber - 1];
    return { stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: `call-${callNumber}`, toolName, input: '{}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage },
    ]) };
  } });
  const fakeTool = (name, result) => ai.tool({ inputSchema: z.object({}), execute: async () => { executed.push(name); return result; } });
  const fakeTools = {
    waluty: fakeTool('waluty', { kurs: 4.25 }),
    kalkulator: fakeTool('kalkulator', { wynik: 425 }),
    dodatkowe: fakeTool('dodatkowe', { wynik: 'nie powinien powstać' }),
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/api/agent/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, Response, Buffer, process: { env: { OPENROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'fake' } }, require(name) {
    if (name.endsWith('/session')) return { hasSession: () => true, sameOrigin: () => true, privateHeaders: {} };
    if (name.endsWith('/image-validation')) return { validImageData: () => false };
    if (name.endsWith('/agent-tools')) return { agentStepLimit: 2, createAgentTools: () => fakeTools };
    if (name.endsWith('/agent-limits')) return { TOOL_LIMIT: 16, TASK_TIMEOUT_MS: 60000, createToolGuard: () => ({ wrap: tools => tools, recordProviderCall: () => {} }) };
    if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => Object.assign(() => model, { tools: { webSearch: () => fakeTool('web_search', {}) }, imageModel: () => 'fake' }) };
    return require(name);
  } });
  const request = new Request('http://localhost/api/agent', { method: 'POST', body: JSON.stringify({ messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Pobierz kurs, przelicz kwotę, a potem wykonaj dodatkową operację.' }] }] }) });
  const response = await exports.POST(request);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\[DONE\]/);
  const chunks = body.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  let message;
  for await (const state of ai.readUIMessageStream({ stream, terminateOnError: true })) message = state;
  assert.equal(model.doStreamCalls.length, 2);
  assert.deepEqual(executed, ['waluty', 'kalkulator']);
  assert.match(JSON.stringify(model.doStreamCalls[1].prompt), /4\.25/);
  assert.equal(message.metadata.limitReached, true);
  assert.equal(message.metadata.stepLimit, 2);
  const html = renderToStaticMarkup(React.createElement(loadProgress(), { parts: message.parts, ...message.metadata }));
  assert.match(html, /Zatrzymałem się po 2 krokach/);
  assert.match(html, /kurs/); assert.match(html, /4\.25/); assert.match(html, /425/);
  assert.match(html, /<li>waluty<\/li><li>kalkulator<\/li>/);
  assert.doesNotMatch(html, /nie powinien powstać/);
});
