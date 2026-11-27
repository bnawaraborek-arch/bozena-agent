const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');

const source = ts.transpileModule(fs.readFileSync('app/knowledge-sources.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
vm.runInNewContext(source, { exports: moduleExports, require(name) { if (name === '../lib/knowledge-config') return { KNOWLEDGE_MIN_SIMILARITY: 0.4 }; return require(name); } });

test('shows only cited high similarity fragments with expandable exact text', () => {
  const parts = [
    { type: 'tool-searchKnowledge', state: 'output-available', output: { ok: true, fragments: [
      { sourceId: '1', title: 'Oferta', content: 'Dokładny tekst.', similarity: 0.82 },
      { sourceId: '2', title: 'Inny', content: 'Nieużyty tekst.', similarity: 0.9 },
      { sourceId: '3', title: 'Słaby', content: 'Słaby tekst.', similarity: 0.2 },
    ] } },
    { type: 'text', text: 'Odpowiedź. ⟦źródło:1⟧ ⟦źródło:3⟧' },
  ];
  const html = renderToStaticMarkup(React.createElement(moduleExports.KnowledgeSources, { parts }));
  assert.match(html, /Oferta/); assert.match(html, /82%/); assert.match(html, /<details>/); assert.match(html, /Pokaż fragment/); assert.match(html, /Dokładny tekst/);
  assert.doesNotMatch(html, /Nieużyty|Słaby/);
  assert.equal(moduleExports.stripKnowledgeMarkers('Odpowiedź. ⟦źródło:1⟧'), 'Odpowiedź.');
});

test('does not invent citations when the model names no fragment', () => {
  const html = renderToStaticMarkup(React.createElement(moduleExports.KnowledgeSources, { parts: [{ type: 'text', text: 'Nie mam tej informacji.' }] }));
  assert.equal(html, '');
});
