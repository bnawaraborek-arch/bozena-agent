const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createHmac } = require('node:crypto');

function expiredCookie() {
  const value = `${Math.floor(Date.now() / 1000) - 1}.${'a'.repeat(43)}`;
  const signature = createHmac('sha256', 'fake-session-secret-12345678901234567890').update(value).digest('base64url');
  return `chat_session=${value}.${signature}`;
}

function renderCards(cards) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/dashboard/dashboard.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require, Date });
  return renderToStaticMarkup(React.createElement(exports.DashboardCards, { cards }));
}

function setup({ session = true, realSession = false, providerError = false, weatherError = false, geocodeError = false, allSourcesDown = false, min = 8, max = 15, rain = 4, probability = 70 } = {}) {
  const cache = {}, requested = [];
  let modelCalls = 0;
  async function fetchMock(url) {
    requested.push(url);
    if (allSourcesDown || (geocodeError && url.includes('geocoding-api'))) throw new Error('offline');
    if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ name: 'Lizbona', country: 'Portugalia', country_code: 'PT', timezone: 'Europe/Lisbon', latitude: 38.72, longitude: -9.14 }] }) };
    if (url.includes('countries.dev')) return { ok: true, json: async () => ({ currencies: [{ code: 'EUR', name: 'Euro' }] }) };
    if (url.includes('api.open-meteo.com')) return { ok: !weatherError, json: async () => ({ timezone: 'Europe/Lisbon', daily: { time: ['2026-12-10'], weather_code: [3], temperature_2m_min: [min], temperature_2m_max: [max], precipitation_sum: [rain], precipitation_probability_max: [probability] } }) };
    if (url.includes('api.nbp.pl')) return { ok: true, json: async () => ({ table: 'A', currency: 'euro', code: 'EUR', rates: [{ effectiveDate: '2026-11-23', mid: 4.25 }] }) };
    if (url.includes('date.nager.at')) return { ok: true, json: async () => url.includes('/2027/') ? ([{ date: '2027-01-01', localName: 'Ano Novo', name: "New Year's Day", global: true, counties: null, types: ['Public'] }]) : ([{ date: '2026-12-25', localName: 'Natal', name: 'Christmas Day', global: true, counties: null, types: ['Public'] }, { date: '2026-12-26', localName: 'Feriado local', name: 'Special Local Day', global: false, counties: ['PT-11'], types: ['Public'] }]) };
    if (url.includes('pl.wikipedia.org')) return { ok: true, json: async () => ({ title: 'Lizbona', extract: 'Lizbona to stolica Portugalii. Leży nad Tagiem. Trzecie zdanie.', content_urls: { desktop: { page: 'https://pl.wikipedia.org/wiki/Lizbona' } } }) };
    throw new Error('Unexpected URL');
  }
  function load(file) {
    file = path.resolve(file); if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Response, Request, URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout, Intl, Date, fetch: fetchMock, process: { env: { OPENROUTER_API_KEY: 'fake-provider-secret', OPENROUTER_MODEL: 'fake-model', CHAT_PASSWORD: 'fake-password-secret', SESSION_SECRET: 'fake-session-secret-12345678901234567890', NODE_ENV: 'development' } }, require(name) {
      if (name.endsWith('/session') && !realSession) return { hasSession: () => session, sameOrigin: () => true, privateHeaders: { 'Cache-Control': 'no-store' } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      if (name === '@openrouter/ai-sdk-provider') return { createOpenRouter: () => () => ({}) };
      if (name === 'ai') return { ...require('ai'), generateText: async () => { modelCalls++; if (providerError) throw new Error('fake-provider-secret fake-password-secret fake-session-secret-12345678901234567890'); return { text: '{"packing":1,"caution":1}' }; } };
      return require(name);
    } });
    return exports;
  }
  return { post: load('app/api/dashboard/route.ts').POST, session: () => load('lib/session.ts'), requested, modelCalls: () => modelCalls };
}
const request = (value, cookie) => new Request('http://localhost/api/dashboard', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value) });
const valid = { city: 'Lizbona', date: '2026-12-10' };

test('dashboard checks session before fetching sources or calling model', async () => {
  const app = setup({ session: false }); const result = await app.post(request(valid));
  assert.equal(result.status, 401); assert.equal(app.requested.length, 0); assert.equal(app.modelCalls(), 0);
});

test('dashboard returns five sourced cards and refresh fetches data again', async () => {
  const app = setup(); const result = await app.post(request(valid)); assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json(); assert.equal(body.cards.length, 5); assert.ok(body.cards.every(card => card.ok && card.fetchedAt && card.source));
  assert.match(body.cards[0].value, /8–15 °C/); assert.match(body.cards[1].value, /4\.25 PLN/);
  assert.match(body.cards[2].value, /2026-12-25: Boże Narodzenie/); assert.match(body.cards[2].value, /2027-01-01: Nowy Rok/); assert.match(body.cards[2].value, /Feriado local/); assert.equal(body.cards[3].value, 'Lizbona to stolica Portugalii. Leży nad Tagiem.');
  assert.match(body.cards[4].value, /względem Polski/); assert.match(body.summary, /cieplejszą warstwę/); assert.match(body.summary, /parasol/); assert.match(body.summary, /2026-12-10/);
  const previousCount = app.requested.length; await new Promise(resolve => setTimeout(resolve, 10));
  const refreshed = await (await app.post(request(valid))).json();
  assert.equal(app.requested.length, 2 * previousCount); assert.equal(app.modelCalls(), 2);
  for (let i = 0; i < 5; i++) assert.ok(Date.parse(refreshed.cards[i].fetchedAt) > Date.parse(body.cards[i].fetchedAt));
});

test('packing advice follows temperature and rainfall probability boundaries', async () => {
  const cool = await (await setup({ min: 14, max: 20, probability: 51 }).post(request(valid))).json();
  assert.match(cool.summary, /cieplejszą warstwę/); assert.match(cool.summary, /parasol/);
  const warm = await (await setup({ min: 15, max: 22, rain: 0, probability: 50 }).post(request(valid))).json();
  assert.doesNotMatch(warm.summary, /cieplejszą warstwę|parasol/);
  assert.match(warm.summary, /2026-12-10/); assert.match(warm.summary, /0 mm/);
});

test('real signed session is required and responses do not expose fake secrets', async () => {
  const app = setup({ realSession: true, providerError: true });
  const denied = await app.post(request(valid));
  assert.equal(denied.status, 401); assert.equal(app.requested.length, 0); assert.equal(app.modelCalls(), 0);
  assert.doesNotMatch(await denied.text(), /fake-provider-secret|fake-password-secret|fake-session-secret/);
  const cookie = app.session().newSession().split(';')[0];
  const tampered = await app.post(request(valid, cookie + 'x'));
  assert.equal(tampered.status, 401); assert.equal(app.requested.length, 0);
  const expired = await app.post(request(valid, expiredCookie()));
  assert.equal(expired.status, 401); assert.equal(app.requested.length, 0);
  const authorized = await app.post(request(valid, cookie));
  assert.equal(authorized.status, 200); assert.equal(authorized.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await authorized.text(), /fake-provider-secret|fake-password-secret|fake-session-secret/);
});

test('dashboard preserves other cards when weather fails and does not invent weather', async () => {
  const app = setup({ weatherError: true }); const response = await app.post(request(valid));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cards.length, 5);
  assert.equal(body.cards[0].title, 'Pogoda'); assert.equal(body.cards[0].ok, false);
  assert.match(body.cards[0].value, /Brak danych/); assert.equal(body.cards[0].source, 'Open-Meteo');
  assert.ok(body.cards.slice(1).every(card => card.ok && card.source && !Number.isNaN(Date.parse(card.fetchedAt))));
  assert.match(body.cards[1].value, /4\.25 PLN/); assert.match(body.cards[2].value, /2026-12-25/);
  assert.match(body.cards[3].value, /stolica Portugalii/); assert.match(body.cards[4].value, /Europe\/Lisbon/);
  const html = renderCards(body.cards);
  assert.match(html, /<h3>Pogoda<\/h3><span class="travel-status">Brak danych<\/span>/);
  assert.equal((html.match(/>OK<\/span>/g) || []).length, 4);
  assert.equal((html.match(/Pobrano:/g) || []).length, 4);
  assert.match(body.summary, /Bez prognozy/); assert.match(body.summary, /Brak danych: Pogoda/);
  assert.doesNotMatch(body.summary, /8–15|4 mm|prognozowane opady/);
});

test('dashboard retains independent Wikipedia card if geocoding fails', async () => {
  const app = setup({ geocodeError: true }); const response = await app.post(request(valid));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cards.length, 5); assert.equal(body.cards[3].ok, true);
  assert.ok(body.cards.filter((_, index) => index !== 3).every(card => !card.ok));
  assert.match(body.summary, /Brak danych: Pogoda, Waluty, Święta, Czas/);
});

test('dashboard returns five unavailable cards when all external sources fail', async () => {
  const app = setup({ allSourcesDown: true }); const response = await app.post(request(valid));
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.cards.length, 5);
  assert.ok(body.cards.every(card => !card.ok && card.source && /Brak danych/.test(card.value)));
  assert.match(body.summary, /Brak danych: Pogoda, Waluty, Święta, Wikipedia, Czas/);
  assert.match(body.summary, /Bez prognozy/); assert.doesNotMatch(body.summary, /8–15|4\.25|4 mm/);
});

test('dashboard rejects invalid input before contacting APIs', async () => {
  const app = setup(); const result = await app.post(request({ city: 'x', date: 'bad' }));
  assert.equal(result.status, 400); assert.equal(app.requested.length, 0); assert.equal(app.modelCalls(), 0);
});

test('dashboard page redirects before rendering when session is missing', async () => {
  const exportsObject = {}; let rendered = false;
  const source = ts.transpileModule(fs.readFileSync('app/dashboard/page.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports: exportsObject, Request, require(name) {
    if (name === 'next/headers') return { headers: async () => new Headers() };
    if (name === 'next/navigation') return { redirect: path => { throw new Error(`redirect:${path}`); } };
    if (name.endsWith('/session')) return { hasSession: () => false };
    if (name === './dashboard') return { Dashboard: () => { rendered = true; } };
    return require(name);
  } });
  await assert.rejects(exportsObject.default(), /redirect:\//);
  assert.equal(rendered, false);
});

test('dashboard page verifies actual signed session before rendering', async () => {
  const session = setup({ realSession: true }).session();
  const cookie = session.newSession().split(';')[0];
  const source = ts.transpileModule(fs.readFileSync('app/dashboard/page.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  async function renderWith(value) {
    const exportsObject = {};
    vm.runInNewContext(source, { exports: exportsObject, Request, require(name) {
      if (name === 'next/headers') return { headers: async () => new Headers(value ? { cookie: value } : {}) };
      if (name === 'next/navigation') return { redirect: path => { throw new Error(`redirect:${path}`); } };
      if (name.endsWith('/session')) return session;
      if (name === './dashboard') return { Dashboard: () => null };
      return require(name);
    } });
    return exportsObject.default();
  }
  await assert.rejects(renderWith(''), /redirect:\//);
  await assert.rejects(renderWith(cookie + 'x'), /redirect:\//);
  await assert.rejects(renderWith(expiredCookie()), /redirect:\//);
  assert.ok(await renderWith(cookie));
});
