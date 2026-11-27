const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const source = ts.transpileModule(fs.readFileSync('app/use-conversation-history.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function mount(storage, fetch) {
  const exports = {}, effects = [], received = [], states = [];
  const react = { useRef: value => ({ current: value }), useState: initial => { const index = states.length; states.push(initial); return [initial, value => { states[index] = value; }]; }, useEffect: fn => effects.push(fn) };
  vm.runInNewContext(source, { exports, window: { localStorage: storage }, fetch, require(name) { if (name === 'react') return react; return require(name); } });
  const hook = exports.useConversationHistory('bona.conversation.chat', messages => received.push(messages));
  effects.forEach(fn => fn());
  return { hook, received, states };
}

test('conversation id survives refresh and restores saved messages from server', async () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const messages = [{ id: 'one', role: 'user', parts: [{ type: 'text', text: 'Witaj' }] }, { id: 'two', role: 'assistant', parts: [{ type: 'text', text: 'Cześć' }] }];
  const requests = [];
  const fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url === '/api/conversations' ? (options.method === 'POST' ? { id: 7 } : { conversations: [] }) : { id: 7, messages } }; };
  const first = mount(storage, fetch);
  assert.equal(await first.hook.getOrCreate(), 7);
  const refreshed = mount(storage, fetch);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.some(request => request.url === '/api/conversations/7'));
  assert.equal(refreshed.received[0][0].parts[0].text, 'Witaj');
  assert.equal(refreshed.received[0][1].parts[0].text, 'Cześć');
  assert.equal(refreshed.states[0], true);
});

test('selecting a conversation loads its messages and persists the selection', async () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const fetch = async url => ({ ok: true, json: async () => url === '/api/conversations' ? { conversations: [{ id: 3, title: 'Temat', created_at: '2026-01-01' }] } : { id: 3, messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'Treść' }] }] } });
  const view = mount(storage, fetch);
  assert.equal(await view.hook.selectConversation(3), true);
  assert.equal(data.get('bona.conversation.chat'), '3');
  assert.equal(view.received[0][0].parts[0].text, 'Treść');
  view.hook.startNew();
  assert.equal(data.size, 0);
  assert.equal(view.received[1].length, 0);
});
