// The package stylesheet survives host minifiers. Lightning CSS (Vite 8's
// CSS minifier) merges -webkit-backdrop-filter and backdrop-filter into
// whichever comes last; with the prefixed one last, Chrome, Edge and Firefox
// lost the loading screen's blur on letramy.com. So in every rule the
// prefixed declaration comes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/flythrough.css', import.meta.url), 'utf8');

test('every backdrop-filter comes after its -webkit- twin, never before it', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^}]*\}/g) ?? [];
  let pairs = 0;
  for (const rule of rules) {
    const decls = rule.slice(rule.indexOf('{') + 1, -1).split(';').map((d) => d.trim().split(':')[0]);
    const plain = decls.indexOf('backdrop-filter');
    const prefixed = decls.indexOf('-webkit-backdrop-filter');
    if (plain < 0 && prefixed < 0) continue;
    pairs++;
    const where = rule.slice(0, rule.indexOf('{')).trim();
    assert.ok(plain >= 0 && prefixed >= 0, `${where}: declare both, -webkit-backdrop-filter then backdrop-filter`);
    assert.ok(prefixed < plain, `${where}: -webkit-backdrop-filter must come before backdrop-filter`);
  }
  assert.ok(pairs > 0, 'the loading screen blurs what is behind it');
});
