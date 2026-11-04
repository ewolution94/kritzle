import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// What Kritzle hands Dashboard (public/ewo.config.json), checked with Folio's own rules, and the
// order a setting is decided in: this device's own choice, then Dashboard's default, then the
// built-in one (src/lib/defaults.ts, and public/boot.js before first paint).
import { checkManifest, resolve } from '../vendor/ewo/elements/config-core.js';
import { languageFor, soundsFor } from '../src/lib/defaults.ts';

const manifest = JSON.parse(readFileSync(new URL('../public/ewo.config.json', import.meta.url), 'utf8'));

test('the manifest is one Dashboard takes: the family’s language, and sounds, on here (no theme: light only)', () => {
  const { ok, problems, manifest: checked } = checkManifest(manifest);
  assert.deepEqual(problems, []);
  assert.ok(ok);
  assert.equal(checked.app, 'kritzle');
  assert.deepEqual(Object.keys(checked.settings), ['lang', 'sounds']);
});

test('with nothing set in Dashboard: the browser’s language and sounds on, the page as it ships', () => {
  const { values, sources } = resolve(manifest, {});
  assert.deepEqual(values, { lang: 'system', sounds: true });
  assert.deepEqual(sources, { lang: 'built-in', sounds: 'own' });
  assert.equal(languageFor('system', values.lang, 'de'), 'de');
  assert.equal(languageFor('system', values.lang, 'en'), 'en');
  assert.equal(soundsFor(null, values.sounds), true);
  // No #ewo-config at all (offline, the dev server): the same.
  assert.equal(soundsFor(null, undefined), true);
});

test('Dashboard’s family default and this app’s own value reach the page', () => {
  assert.deepEqual(resolve(manifest, { family: { lang: 'en', theme: 'dark' } }).values, { lang: 'en', sounds: true });
  assert.deepEqual(resolve(manifest, { family: { lang: 'en' }, app: { lang: 'de' } }).values, { lang: 'de', sounds: true });
  // Sounds stay on whatever the family says (Kritzle's own default comes first); set for Kritzle, off.
  assert.equal(resolve(manifest, { family: { sounds: false } }).values.sounds, true);
  assert.equal(resolve(manifest, { family: { sounds: false }, app: { sounds: false } }).values.sounds, false);
  // A value the family doesn't have falls back to the built-in one.
  assert.deepEqual(resolve(manifest, { family: { lang: 'fr' } }).values, { lang: 'system', sounds: true });
});

test('the device’s own choice beats Dashboard’s default, which beats the built-in one', () => {
  // QA's `ewo:lang` = `en` is this device's own choice, so it keeps winning.
  assert.equal(languageFor('en', 'de', 'de'), 'en');
  assert.equal(languageFor('system', 'en', 'de'), 'en');
  assert.equal(languageFor('system', 'system', 'de'), 'de');
  assert.equal(languageFor('system', undefined, 'en'), 'en');
  // Sounds: the switch on this device (`kritzle:sound`), else Dashboard's, else on.
  assert.equal(soundsFor('on', false), true);
  assert.equal(soundsFor('off', true), false);
  assert.equal(soundsFor(null, false), false);
  assert.equal(soundsFor(null, 'off'), true);
});

/** public/boot.js against a stub page: the language it applies before first paint. */
function boot({ saved = {}, config, languages = ['de-DE', 'de'] }) {
  const root = { dataset: {}, lang: 'de', classList: { add() {}, remove() {} }, style: { setProperty() {} } };
  const document = {
    documentElement: root,
    getElementById: (id) => (id === 'ewo-config' && config ? { textContent: JSON.stringify(config) } : null),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const localStorage = { getItem: (key) => saved[key] ?? null };
  vm.runInNewContext(readFileSync(new URL('../public/boot.js', import.meta.url), 'utf8'), {
    document,
    localStorage,
    matchMedia: () => ({ matches: false }),
    navigator: { languages, language: languages[0] },
    location: { search: '' },
    screen: {},
    addEventListener() {},
    setTimeout() {},
  });
  return { theme: root.dataset.theme, lang: root.lang };
}

test('before first paint: the saved language, else Dashboard’s, else the browser’s; never a theme', () => {
  // Nothing saved, no Dashboard: today's page (the browser's language, English otherwise).
  assert.deepEqual(boot({}), { theme: undefined, lang: 'de' });
  assert.equal(boot({ languages: ['fr-FR', 'en-GB'] }).lang, 'en');
  assert.equal(boot({ languages: ['fr-FR'] }).lang, 'en');
  assert.deepEqual(boot({ config: { lang: 'system', sounds: true } }), { theme: undefined, lang: 'de' });
  // Dashboard's language on a device that hasn't picked; light only, whatever a block says.
  assert.deepEqual(boot({ config: { lang: 'en', theme: 'dark' } }), { theme: undefined, lang: 'en' });
  // The device's own pick wins, `ewo:lang` = `en` (QA's) among them.
  assert.equal(boot({ saved: { 'ewo:lang': 'en' }, config: { lang: 'de' } }).lang, 'en');
  assert.equal(boot({ saved: { 'ewo:lang': 'de' }, config: { lang: 'en' }, languages: ['en-US'] }).lang, 'de');
});
