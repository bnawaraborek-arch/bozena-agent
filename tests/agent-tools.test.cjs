const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup(respond = () => { throw Error('offline'); }) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('lib/agent-tools.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, require, URLSearchParams, AbortSignal, Intl, Date, fetch: respond, process: { env: { OPENROUTER_API_KEY: 'secret-test-value', OPENROUTER_MODEL: 'example', CHAT_PASSWORD: 'private', SESSION_SECRET: 'private' } } });
  return exports.createAgentTools('example/model');
}
const options = { toolCallId: 'test', messages: [] };
const response = data => ({ ok: true, json: async () => data });

test('calculator, clock and notes handle valid and invalid requests', async () => {
  const t = setup();
  assert.equal((await t.kalkulator.execute({ a: 10, b: 2, dzialanie: 'dzielenie' }, options)).wynik, 5);
  assert.equal((await t.kalkulator.execute({ a: 10, b: 0, dzialanie: 'dzielenie' }, options)).ok, false);
  assert.equal((await t.czas.execute({ strefa: 'Europe/Warsaw' }, options)).ok, true);
  assert.equal((await t.czas.execute({ strefa: 'nie-istnieje' }, options)).ok, false);
  assert.equal((await t.notatki.execute({ akcja: 'zapisz', tekst: 'Plan podróży' }, options)).ok, true);
  assert.equal((await t.notatki.execute({ akcja: 'odczytaj' }, options)).notatki[0].tekst, 'Plan podróży');
  assert.equal((await t.notatki.execute({ akcja: 'zapisz' }, options)).ok, false);
});

test('diagnostics exposes only boolean configuration status', async () => {
  const result = await setup().diagnostyka.execute({}, options);
  assert.equal(result.model, 'example/model'); assert.equal(result.limitKrokow, 6);
  assert.equal(result.narzedzia.length, 10); assert.equal(result.konfiguracja.OPENROUTER_API_KEY, true);
  assert.doesNotMatch(JSON.stringify(result), /secret-test-value|private/);
});

test('external APIs return useful data and errors are handled', async () => {
  const seen = [];
  const t = setup(async url => {
    seen.push(url);
    if (url.includes('geocoding-api')) return response({ results: [{ name: 'Warszawa', country: 'Polska', latitude: 52.2, longitude: 21 }] });
    if (url.includes('api.open-meteo')) return response({ timezone: 'Europe/Warsaw', daily: { time: ['2026-11-24'], weather_code: [1], temperature_2m_max: [8], temperature_2m_min: [2], precipitation_sum: [0], precipitation_probability_max: [10] } });
    if (url.includes('api.nbp.pl')) return response({ table: 'A', currency: 'euro', code: 'EUR', rates: [{ effectiveDate: '2026-11-23', mid: 4.2 }] });
    if (url.includes('date.nager.at')) return response([{ date: '2026-01-01', localName: 'Nowy Rok', name: 'New Year', global: true, counties: null, types: ['Public'] }]);
    if (url.includes('wikipedia.org')) return response({ title: 'Warszawa', extract: 'Stolica Polski.', content_urls: { desktop: { page: 'https://pl.wikipedia.org/wiki/Warszawa' } } });
    throw Error('unexpected');
  });
  const weather = await t.pogoda.execute({ miasto: 'Warszawa', data: '2026-11-24', kraj: 'PL' }, options);
  assert.equal(weather.lokalizacja.name, 'Warszawa'); assert.ok(weather.pobrano);
  const rate = await t.waluty.execute({ waluta: 'EUR', kwota: 2, kierunek: 'na_pln' }, options);
  assert.equal(rate.wynik, 8.4); assert.equal(rate.dataKursu, '2026-11-23');
  assert.equal((await t.swieta.execute({ kraj: 'PL', rok: 2026 }, options)).swieta[0].localName, 'Nowy Rok');
  assert.match((await t.wikipedia.execute({ haslo: 'Warszawa' }, options)).link, /^https:\/\/pl\.wikipedia\.org\//);
  assert.equal((await setup().wikipedia.execute({ haslo: 'brak' }, options)).ok, false);
  assert.equal(seen.length, 5);
});

test('schemas reject malformed input', () => {
  const t = setup();
  assert.equal(t.pogoda.inputSchema.safeParse({ miasto: 'X', data: 'jutro' }).success, false);
  assert.equal(t.waluty.inputSchema.safeParse({ waluta: '../USD', kwota: 1, kierunek: 'na_pln' }).success, false);
  assert.equal(t.swieta.inputSchema.safeParse({ kraj: 'PL', rok: 9999 }).success, false);
  assert.equal(t.kalkulator.inputSchema.safeParse({ a: 1, b: 2, dzialanie: 'eval' }).success, false);
});
