const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function load(env) {
  const exports = {};
  let serverOnly = false;
  const calls = [];
  const source = ts.transpileModule(fs.readFileSync('lib/supabase.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, process: { env }, require(name) {
    if (name === 'server-only') { serverOnly = true; return {}; }
    if (name === '@supabase/supabase-js') return { createClient: (url, key, options) => { calls.push({ url, key, options }); return { configured: true }; } };
    throw Error('Nieoczekiwany import');
  } });
  return { exports, calls, serverOnly };
}

test('Supabase client is server-only and created lazily with server auth options', () => {
  const app = load({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'fake-secret' });
  assert.equal(app.serverOnly, true); assert.equal(app.calls.length, 0);
  assert.equal(app.exports.getSupabase().configured, true);
  assert.equal(app.calls[0].url, 'https://example.supabase.co'); assert.equal(app.calls[0].key, 'fake-secret');
  assert.equal(app.calls[0].options.auth.persistSession, false);
  assert.equal(app.calls[0].options.auth.autoRefreshToken, false);
  assert.equal(app.calls[0].options.auth.detectSessionInUrl, false);
});

test('missing Supabase configuration fails without exposing values', () => {
  for (const env of [{}, { SUPABASE_URL: 'https://example.supabase.co' }, { SUPABASE_SECRET_KEY: 'fake-secret' }]) {
    const app = load(env);
    assert.throws(() => app.exports.getSupabase(), error => /Brak konfiguracji Supabase/.test(error.message) && !error.message.includes('fake-secret'));
    assert.equal(app.calls.length, 0);
  }
});
