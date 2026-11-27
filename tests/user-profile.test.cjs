const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup() {
  let row = null;
  const db = { from() { return {
    select() { return { eq() { return { maybeSingle: async () => ({ data: row && structuredClone(row), error: null }) }; } }; },
    async insert(value) { if (row) return { error: { code: '23505' } }; row = { name: value.name, preferences: value.preferences }; return { error: null }; },
    update(value) {
      const matches = [];
      const builder = { eq(key, val) { if (key !== 'id') matches.push([key, val]); return builder; }, is(key) { matches.push([key, null]); return builder; },
        async select() {
          if (matches.some(([key, val]) => key === 'preferences' && val !== null ? JSON.stringify(row[key]) !== val : row[key] !== val)) return { data: [], error: null };
          row = structuredClone(value); return { data: [{ id: 1 }], error: null };
        } };
      return builder;
    },
  }; } };
  const source = ts.transpileModule(fs.readFileSync('lib/user-profile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  function session() {
    const exports = {};
    vm.runInNewContext(source, { exports, require(name) { if (name === 'server-only') return {}; if (name === './supabase') return { getSupabase: () => db }; return require(name); } });
    return exports;
  }
  return { session, row: () => row };
}

test('profile saves name and merges JSON preferences across new sessions', async () => {
  const db = setup();
  assert.equal(await db.session().saveUserProfile({ name: 'Anna', preferences: { miasto: 'Krakowie' } }, 'Mam na imię Anna i mieszkam w Krakowie.'), true);
  assert.equal(await db.session().saveUserProfile({ preferences: { jedzenie: 'pierogi' } }, 'Lubię pierogi.'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await db.session().loadUserProfile())), { name: 'Anna', preferences: { miasto: 'Krakowie', jedzenie: 'pierogi' } });
  assert.equal(await db.session().saveUserProfile({ name: 'Ania' }, 'Mam na imię Ania.'), true);
  assert.equal(db.row().name, 'Ania'); assert.equal(db.row().preferences.miasto, 'Krakowie');
  const results = await Promise.all([
    db.session().saveUserProfile({ preferences: { styl: 'krótko' } }, 'Pisz krótko.'),
    db.session().saveUserProfile({ preferences: { napój: 'herbatę' } }, 'Lubię herbatę.'),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(db.row().preferences.styl, 'krótko'); assert.equal(db.row().preferences.napój, 'herbatę');
});

test('explicit favorite food statement preserves earlier profile facts', async () => {
  const db = setup();
  const profile = db.session();
  assert.equal(await profile.saveUserProfile({ name: 'Anna', preferences: { miasto: 'Krakowie' } }, 'Mam na imię Anna i mieszkam w Krakowie.'), true);
  assert.equal(await profile.saveUserProfile({ preferences: { ulubione_jedzenie: 'pierogi' } }, 'Moim ulubionym jedzeniem są pierogi.'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await profile.loadUserProfile())), { name: 'Anna', preferences: { miasto: 'Krakowie', ulubione_jedzenie: 'pierogi' } });
});

test('rejects secrets, sensitive facts, guesses, jokes and values absent from the statement', async () => {
  const db = setup(); const api = db.session();
  for (const [update, text] of [
    [{ preferences: { hasło: 'abc' } }, 'Moje hasło to abc, lubię pierogi.'],
    [{ preferences: { choroba: 'cukrzyca' } }, 'Mam chorobę cukrzyca.'],
    [{ preferences: { miasto: 'Paryżu' } }, 'Planuję mieszkać w Paryżu.'],
    [{ preferences: { miasto: 'Marsie' } }, 'Żartuję, mieszkam na Marsie.'],
    [{ name: 'Anna' }, 'Czy ona ma na imię Anna?'],
    [{ preferences: { miasto: 'Kraków' } }, 'Lubię pierogi.'],
    [{ preferences: { jedzenie: 'pierogi' } }, 'Czy moim ulubionym jedzeniem są pierogi?'],
    [{ preferences: { jedzenie: 'pierogi' } }, 'Żartuję: moim ulubionym jedzeniem są pierogi.'],
  ]) assert.equal(await api.saveUserProfile(update, text), false);
  assert.equal(db.row(), null);
});
