const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync('app/agent-progress.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(source, { exports: exportsObject, require });
const { AgentProgress } = exportsObject;

test('completed tools are displayed in order above results and unfinished calls are omitted', () => {
  const html = renderToStaticMarkup(React.createElement(AgentProgress, { parts: [
    { type: 'tool-pogoda', state: 'output-available', output: { temperatura: 10 } },
    { type: 'tool-waluty', state: 'output-available', output: { kurs: 4.2 } },
    { type: 'tool-czas', state: 'input-streaming' },
    { type: 'tool-kalkulator', state: 'output-error', errorText: 'error' },
  ], limitReached: true }));
  assert.match(html, /<ol><li>pogoda<\/li><li>waluty<\/li><li>kalkulator<\/li><\/ol>/);
  assert.ok(html.indexOf('Wykonane kroki') < html.indexOf('Zatrzymałem się po 6 krokach'));
  assert.match(html, /temperatura/); assert.match(html, /kurs/); assert.match(html, /Narzędzie zgłosiło błąd/);
  assert.doesNotMatch(html, /<li>czas<\/li>/);
});

test('normal response does not display a limit warning and image data is not printed', () => {
  const parts = [{ type: 'tool-generate_image', state: 'output-available', output: { ok: true, url: 'data:image/png;base64,secret' } }];
  const normal = renderToStaticMarkup(React.createElement(AgentProgress, { parts }));
  assert.doesNotMatch(normal, /Zatrzymałem/);
  const limited = renderToStaticMarkup(React.createElement(AgentProgress, { parts, limitReached: true }));
  assert.match(limited, /Wygenerowany obraz jest widoczny/); assert.doesNotMatch(limited, /base64/);
});

test('a failed tool shows the error and preserves successful partial results', () => {
  const html = renderToStaticMarkup(React.createElement(AgentProgress, { parts: [
    { type: 'tool-waluty', state: 'output-available', output: { ok: true, kurs: 4.2 } },
    { type: 'tool-pogoda', state: 'output-available', output: { ok: false, blad: 'Źródło nie odpowiada' } },
  ] }));
  assert.match(html, /Nie udało się sprawdzić/); assert.match(html, /Źródło nie odpowiada/); assert.match(html, /4\.2/);
});
