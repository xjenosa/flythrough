// README.md's framework code is cut from the example projects, which
// test/examples-test.mjs builds and runs in a browser. This keeps the two
// from drifting: a snippet edited by hand in the README, or an example
// changed without `npm run snippets`, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fill } from '../tools/snippets.mjs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('README framework snippets match the example projects', () => {
  const { text, sources } = fill(readme);
  assert.ok(sources.length > 0, 'the README has snippet blocks');
  assert.equal(text, readme, 'run `npm run snippets` to refresh the README');
});

test('every framework has its code in the README: the component first, then the element itself', () => {
  const { sources } = fill(readme);
  const at = (start, end = '') => sources.findIndex((s) => s.startsWith(start) && s.endsWith(end));
  // React and Vue: the <Flythrough> component (its imports, its use, a
  // plain scrub), and below it the element written directly.
  for (const fw of ['react', 'vue']) {
    for (const region of ['#imports', '#component', '#scrub']) assert.ok(at(`examples/${fw}/src/App.`, region) >= 0, `${fw}: the component, ${region}`);
    assert.ok(at(`examples/${fw}/src/Tour.`) >= 0, `${fw}: the element itself`);
    assert.ok(at(`examples/${fw}/src/PlainApp.`, '#usage') >= 0, `${fw}: the element itself, its use`);
    assert.ok(at(`examples/${fw}/src/App.`, '#component') < at(`examples/${fw}/src/Tour.`), `${fw}: the component comes first`);
  }
  // Svelte uses the element: it needs no component.
  assert.ok(at('examples/svelte/src/Tour.') >= 0, 'svelte: the element');
  assert.ok(at('examples/svelte/src/App.', '#usage') >= 0, 'svelte: its use');
});

test('no fenced code inside the Frameworks section is outside a snippet block', () => {
  const start = readme.indexOf('\n## Frameworks\n');
  assert.ok(start > 0, 'the README has a Frameworks section');
  const end = readme.indexOf('\n## ', start + 1);
  const section = readme.slice(start, end < 0 ? undefined : end).replace(/<!-- snippet: \S+ -->\n[\s\S]*?<!-- \/snippet -->/g, '');
  assert.ok(!section.includes('```'), 'hand-written code in the Frameworks section');
});
