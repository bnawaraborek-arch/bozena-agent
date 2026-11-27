const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup({ authenticated = true, failChunks = false, failDelete = false, failEmbedding = false, failBackfill = false, oldChunks = [], oldDocuments = [] } = {}) {
  const documents = structuredClone(oldDocuments), chunks = [], existing = structuredClone(oldChunks), embeddingCalls = [];
  let dbCalls = 0;
  const db = { from(table) {
    dbCalls++;
    return {
      insert(value) {
        if (table === 'documents') return { select: () => ({ single: async () => { documents.push({ id: 7, ...value }); return { data: { id: 7 }, error: null }; } }) };
        if (failChunks) return Promise.resolve({ error: { message: 'private database error' } });
        chunks.push(...value); return Promise.resolve({ error: null });
      },
      select() { if (table === 'documents') return { eq: async (_key, title) => ({ data: documents.filter(item => item.title === title), error: null }), order: async () => ({ data: documents.map(item => ({ ...item, chunks: [{ count: chunks.filter(chunk => chunk.document_id === item.id).length }] })), error: null }) }; return { is() { return { order() { return { range: async (from, to) => ({ data: existing.filter(item => item.embedding == null).slice(from, to + 1), error: null }) }; } }; } }; },
      update(value) { return { eq(_key, id) { return { is() { return { select: async () => {
        if (failBackfill) return { data: null, error: {} };
        const item = existing.find(item => item.id === id && item.embedding == null);
        if (!item) return { data: [], error: null }; item.embedding = value.embedding; return { data: [{ id }], error: null };
      } }; } }; } }; },
      delete() { const remove = ids => { if (failDelete) return { error: {}, data: null }; const found = documents.filter(item => ids.includes(item.id)); for (const item of found) documents.splice(documents.indexOf(item), 1); for (let i = chunks.length - 1; i >= 0; i--) if (ids.includes(chunks[i].document_id)) chunks.splice(i, 1); return { error: null, data: found }; }; return { eq: (_key, id) => ({ select: async () => remove([id]) }), in: (_key, ids) => ({ eq: () => ({ select: async () => remove(ids) }) }) }; },
    };
  } };
  const cache = {};
  function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Request, Response, ReadableStream, TextEncoder, require(name) {
      if (name.endsWith('/session')) return { hasSession: () => authenticated, sameOrigin: () => true, privateHeaders: { 'Cache-Control': 'no-store' } };
      if (name.endsWith('/supabase')) return { getSupabase: () => db };
      if (name.endsWith('/model')) return { getEmbeddingModel: () => 'fake-model' };
      if (name === 'ai') return { embedMany: async options => { embeddingCalls.push(options); if (failEmbedding) throw new Error('private provider error'); return { embeddings: options.values.map((_, index) => Array(1536).fill(index + 1)) }; } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      return require(name);
    } });
    return exports;
  }
  const route = load('app/api/documents/route.ts');
  return { post: route.POST, get: route.GET, delete: route.DELETE, split: load('lib/knowledge-chunks.ts').splitKnowledgeText, documents, chunks, existing, embeddingCalls, calls: () => dbCalls };
}
const request = body => new Request('http://localhost/api/documents', { method: 'POST', body: JSON.stringify(body) });
const events = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

test('splits paragraphs separately and long paragraphs at sentence boundaries', () => {
  const { split } = setup();
  const first = 'A'.repeat(400) + '.', second = 'B'.repeat(400) + '.', third = 'C'.repeat(30) + '.';
  assert.deepEqual(Array.from(split(`Krótki.\n\nDrugi.\r\n\r\n${first} ${second} ${third}`)), ['Krótki.', 'Drugi.', first, `${second} ${third}`]);
  const longSentence = 'A'.repeat(810) + '.';
  assert.deepEqual(Array.from(split(longSentence)), [longSentence]);
});

test('rejects unauthenticated and invalid requests before database access', async () => {
  const denied = setup({ authenticated: false });
  assert.equal((await denied.post(request({ title: 'T', content: 'Treść' }))).status, 401); assert.equal(denied.calls(), 0);
  const app = setup();
  for (const body of [{ title: ' ', content: 'Treść' }, { title: 'T', content: ' ' }, { title: 'T', content: 'x'.repeat(20001) }]) assert.equal((await app.post(request(body))).status, 400);
  assert.equal(app.calls(), 0);
});

test('saves embeddings and fills older missing embeddings in one call', async () => {
  const app = setup({ oldChunks: [{ id: 3, content: 'Starszy.', embedding: null }, { id: 4, content: 'Gotowy.', embedding: [9] }] });
  const response = await app.post(request({ title: '  Podróże ', content: 'Pierwszy.\n\nDrugi.' }));
  assert.equal(response.status, 200); const result = await events(response); assert.deepEqual(result.map(item => item.stage).filter(Boolean), ['Dzielę tekst…', 'Tworzę embeddingi…', 'Zapisuję…']); assert.deepEqual(result.at(-1), { title: 'Podróże', count: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(app.documents)), [{ id: 7, title: 'Podróże' }]);
  assert.deepEqual(app.chunks.map(({ document_id, chunk_index, content, embedding }) => ({ document_id, chunk_index, content, first: embedding[0], length: embedding.length })), [{ document_id: 7, chunk_index: 0, content: 'Pierwszy.', first: 1, length: 1536 }, { document_id: 7, chunk_index: 1, content: 'Drugi.', first: 2, length: 1536 }]);
  assert.equal(app.embeddingCalls.length, 1); assert.deepEqual(Array.from(app.embeddingCalls[0].values), ['Pierwszy.', 'Drugi.', 'Starszy.']);
  assert.equal(app.existing[0].embedding[0], 3); assert.deepEqual(app.existing[1].embedding, [9]);
});

test('embedding and backfill failures clean up the new document', async () => {
  for (const options of [{ failEmbedding: true }, { failBackfill: true, oldChunks: [{ id: 3, content: 'Starszy.', embedding: null }] }]) {
    const app = setup(options); const response = await app.post(request({ title: 'T', content: 'Treść' }));
    assert.equal(response.status, 200); assert.match((await events(response)).at(-1).error, /Dokument został usunięty/); assert.equal(app.documents.length, 0);
  }
});

test('cleans up document on chunk failure and reports failed cleanup', async () => {
  for (const failDelete of [false, true]) {
    const app = setup({ failChunks: true, failDelete }); const response = await app.post(request({ title: 'T', content: 'Treść' }));
    assert.equal(response.status, 200); const message = (await events(response)).at(-1).error;
    assert.doesNotMatch(message, /private database error/);
    assert.equal(app.documents.length, failDelete ? 1 : 0);
    assert.match(message, failDelete ? /nie udało się usunąć/ : /Dokument został usunięty/);
  }
});

test('requires authentication for list and deletion', async () => {
  const app = setup({ authenticated: false });
  assert.equal((await app.get(new Request('http://localhost/api/documents'))).status, 401);
  assert.equal((await app.delete(request({ id: 1 }))).status, 401);
  assert.equal(app.calls(), 0);
});

test('requires confirmation to replace and removes old version only after success', async () => {
  const app = setup({ oldDocuments: [{ id: 2, title: 'T', created_at: '2026-01-01' }] });
  assert.equal((await app.post(request({ title: 'T', content: 'Nowy.' }))).status, 409);
  assert.equal(app.documents.length, 1);
  const response = await app.post(request({ title: 'T', content: 'Nowy.', replaceIds: [2] }));
  assert.equal((await events(response)).at(-1).count, 1);
  assert.deepEqual(app.documents.map(doc => doc.id), [7]);
  const listed = await (await app.get(new Request('http://localhost/api/documents'))).json();
  assert.equal(listed.documents[0].count, 1);
  assert.equal((await app.delete(request({ id: 7 }))).status, 200); assert.equal(app.documents.length, 0);
});

test('failed replacement keeps the old document', async () => {
  const app = setup({ failEmbedding: true, oldDocuments: [{ id: 2, title: 'T' }] });
  const response = await app.post(request({ title: 'T', content: 'Nowy.', replaceIds: [2] }));
  assert.match((await events(response)).at(-1).error, /tworzenia embeddingów/);
  assert.deepEqual(app.documents.map(doc => doc.id), [2]);
});

test('keeps the new document when removal of the previous version cannot be confirmed', async () => {
  const app = setup({ failDelete: true, oldDocuments: [{ id: 2, title: 'T' }] });
  const response = await app.post(request({ title: 'T', content: 'Nowy.', replaceIds: [2] }));
  assert.match((await events(response)).at(-1).error, /Sprawdź listę dokumentów/);
  assert.deepEqual(app.documents.map(doc => doc.id), [2, 7]);
});
