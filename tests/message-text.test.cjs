const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync('app/message-text.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(source, { exports: exportsObject, require, URL });
const render = text => renderToStaticMarkup(React.createElement(exportsObject.MessageText, { text }));

test('renders headings, lists, emphasis, links, separators and basic math', () => {
  const html = render('### Wynik\n\n- **Kurs**: 4,25\n- [NBP](https://nbp.pl)\n\n1. Pierwszy\n2. Drugi\n\n---\n\n$\\frac{1500}{4,25}$ i $x^{2}$');
  assert.match(html, /aria-level="3"/); assert.match(html, /<ul><li><strong>Kurs<\/strong>/);
  assert.match(html, /href="https:\/\/nbp.pl"/); assert.match(html, /<ol start="1">/);
  assert.match(html, /<hr\/>/); assert.match(html, /math-fraction/); assert.match(html, /<sup>2<\/sup>/);
});

test('does not execute HTML or dangerous links and keeps code literal', () => {
  const html = render('[zły](javascript:alert) <script>alert(1)</script>\n\n```\n### **tekst**\n```');
  assert.doesNotMatch(html, /href="javascript/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<pre><code>### \*\*tekst\*\*<\/code><\/pre>/);
});
