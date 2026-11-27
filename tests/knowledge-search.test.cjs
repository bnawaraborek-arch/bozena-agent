const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup({ rows = [], embeddingError = false, dbError = false } = {}) {
  const calls = [];
  const source = ts.transpileModule(fs.readFileSync('lib/knowledge-search.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Number, require(name) {
    if (name === 'server-only') return {};
    if (name === './model') return { getEmbeddingModel: () => 'embedding-model' };
    if (name === './knowledge-config') return { KNOWLEDGE_MIN_SIMILARITY: 0.4 };
    if (name === './supabase') return { getSupabase: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return { data: rows, error: dbError ? {} : null }; } }) };
    if (name === 'ai') return { embed: async options => { calls.push(options); if (embeddingError) throw new Error('private'); return { embedding: Array(1536).fill(0.5) }; } };
    return require(name);
  } });
  return { search: exports.searchKnowledge, calls };
}

test('embeds the question using the configured model and returns at most three matches', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, title: `Dokument ${i}`, content: `Treść ${i}`, similarity: 0.9 - i / 10, document_id: i }));
  const app = setup({ rows });
  const result = await app.search('Jaka jest cena?');
  assert.equal(app.calls[0].model, 'embedding-model'); assert.equal(app.calls[0].value, 'Jaka jest cena?');
  assert.equal(app.calls[1].name, 'match_chunks'); assert.equal(app.calls[1].params.match_count, 3); assert.equal(app.calls[1].params.query_embedding.length, 1536);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), rows.slice(0, 3).map(({ id, title, content, similarity }) => ({ sourceId: String(id), title, content, similarity })));
});

test('filters results below the similarity threshold', async () => {
  const app = setup({ rows: [{ id: 1, title: 'A', content: 'A', similarity: 0.399 }, { id: 2, title: 'B', content: 'B', similarity: 0.4 }] });
  const result = await app.search('Pytanie');
  assert.equal(result.length, 1); assert.equal(result[0].title, 'B');
});

test('returns empty matches and propagates provider and database failures', async () => {
  assert.equal((await setup().search('Pytanie')).length, 0);
  const provider = setup({ embeddingError: true }); await assert.rejects(provider.search('Pytanie')); assert.equal(provider.calls.length, 1);
  await assert.rejects(setup({ dbError: true }).search('Pytanie'));
});
