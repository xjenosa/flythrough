// What ships where (CLAUDE.md, "Package"): the debug overlay and the frame
// maker's tools stay out of the player, and every entry is in the package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const imports = (file) => [...read(file).matchAll(/^\s*(?:import|export)\b[^'"]*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
const pkg = JSON.parse(read('package.json'));

test('the player never loads the debug overlay', () => {
  for (const file of ['src/index.ts', 'src/flythrough.ts', 'src/manifest.ts', 'src/math.ts']) {
    assert.ok(!imports(file).some((from) => from.includes('debug')), `${file} imports the debug overlay`);
  }
  assert.ok(!read('src/flythrough.css').includes('ft__debug'), 'the stylesheet carries debug styles');
  // The overlay itself only needs the pure math and the player's types.
  assert.deepEqual(imports('src/debug.ts').sort(), ['./flythrough.js', './math.js']);
  assert.match(read('src/debug.ts'), /import type \{ Flythrough \} from '\.\/flythrough\.js'/);
});

test('only the GSAP engine needs gsap; the player, the entry without GSAP and the helpers need nothing', () => {
  const outside = (file) => imports(file).filter((from) => !from.startsWith('.'));
  assert.deepEqual([...new Set(outside('src/gsap-engine.ts'))].sort(), ['gsap', 'gsap/ScrollToPlugin', 'gsap/ScrollTrigger']);
  for (const file of ['src/flythrough.ts', 'src/engine.ts', 'src/native-engine.ts', 'src/no-gsap.ts', 'src/index.ts', 'src/manifest.ts', 'src/math.ts', 'src/debug.ts']) {
    assert.deepEqual(outside(file), [], file);
  }
  // The default entry is the one that brings the GSAP engine; the other never does.
  assert.ok(imports('src/index.ts').includes('./gsap-engine.js'));
  assert.deepEqual(imports('src/no-gsap.ts').sort(), ['./flythrough.js', './flythrough.js', './manifest.js', './native-engine.js']);
  assert.ok(!imports('src/flythrough.ts').some((from) => from.includes('gsap-engine') || from.includes('native-engine')));
  // sharp and ffmpeg are the frame maker's, loaded only when it runs.
  assert.deepEqual(outside('bin/frames.mjs').filter((from) => !from.startsWith('node:')).sort(), ['ffmpeg-static', 'sharp']);
});

test("every entry is exported, and the frame maker's tools are optional", () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './astro', './debug', './manifest', './no-gsap', './package.json', './react', './style.css', './vue']);
  assert.equal(pkg.dependencies, undefined);
  // gsap alone is required; each other peer belongs to one entry or to the frame maker.
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ['ffmpeg-static', 'gsap', 'lenis', 'react', 'sharp', 'vue']);
  assert.deepEqual(Object.keys(pkg.peerDependenciesMeta).sort(), ['ffmpeg-static', 'lenis', 'react', 'sharp', 'vue']);
  // Nothing of the examples or the tests goes into the package.
  assert.deepEqual(pkg.files, ['dist', 'bin', 'CHANGELOG.md']);
});

test('the React and Vue components are their own entries: only they import react or vue', () => {
  const outside = (file) => [...new Set(imports(file).filter((from) => !from.startsWith('.')))];
  assert.deepEqual(outside('src/react.ts'), ['react']);
  assert.deepEqual(outside('src/vue.ts'), ['vue']);
  for (const file of ['src/index.ts', 'src/no-gsap.ts', 'src/flythrough.ts', 'src/manifest.ts', 'src/math.ts', 'src/debug.ts', 'src/engine.ts', 'src/gsap-engine.ts', 'src/native-engine.ts']) {
    assert.ok(!imports(file).some((from) => /react|vue/.test(from)), file);
  }
  // Each loads the player itself, in the browser, by one entry or the other.
  for (const file of ['src/react.ts', 'src/vue.ts']) {
    const text = read(file);
    assert.match(text, /import\('\.\/index\.js'\)/, file);
    assert.match(text, /import\('\.\/no-gsap\.js'\)/, file);
    assert.ok(!/^import [^t][^\n]*'\.\/(index|no-gsap|flythrough)\.js'/m.test(text), `${file} loads the player on import`);
  }
  assert.match(read('src/react.ts'), /^'use client';/);
});

test('the wrappers and the Astro component take every attribute in the README as a prop', () => {
  const readme = read('README.md');
  const table = readme.slice(readme.indexOf('## Attributes'), readme.indexOf('### Stops'));
  const names = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  const camel = (n) => n.replace(/-(.)/g, (_, c) => c.toUpperCase());
  for (const name of names) {
    assert.match(read('src/react.ts'), new RegExp(`^  ${camel(name)}\\??: `, 'm'), `${name} is not a prop of the React component`);
    assert.match(read('src/vue.ts'), new RegExp(`^    ${camel(name)}: `, 'm'), `${name} is not a prop of the Vue component`);
    assert.match(read('src/astro/FlythroughPlayer.astro'), new RegExp(`^  ${camel(name)}\\??: `, 'm'), `${name} is not a prop of the Astro component`);
  }
});

test('the Astro component passes other attributes on, and is not named like the stylesheet', () => {
  const astro = read('src/astro/FlythroughPlayer.astro');
  assert.match(astro, /class: cls, \.\.\.rest \} = Astro\.props;/);
  assert.match(astro, /^  \{\.\.\.rest\}$/m);
  // Astro names a page's CSS file after what imported the stylesheet: a
  // component file called like it gives two names that differ only in case.
  const file = pkg.exports['./astro'].split('/').pop().replace('.astro', '');
  const sheet = pkg.exports['./style.css'].split('/').pop().replace('.css', '');
  assert.notEqual(file.toLowerCase(), sheet.toLowerCase());
});

test('Node: the range the default entry can be imported on, as the README says', () => {
  assert.equal(pkg.engines.node, '^20.19.0 || >=22.12.0');
  assert.match(read('README.md'), /Node 20\.19 or later \(on Node\s+22: 22\.12 or later\)/);
});

test('the React types name every attribute in the README', () => {
  const readme = read('README.md');
  const table = readme.slice(readme.indexOf('## Attributes'), readme.indexOf('### Stops'));
  const names = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.ok(names.length >= 16);
  const types = read('src/react.ts');
  const own = types.slice(types.indexOf('export interface FlythroughAttributes'));
  for (const name of names) assert.match(own, new RegExp(`^  '?${name}'?\\??: `, 'm'), `${name} is missing from FlythroughAttributes in src/react.ts`);
});

// ---- the built files, as npm would publish them
// The build shortens the private members' names (tools/build.mjs). The
// browser tests run on src/, so this is where the built package is checked:
// what is in it, that every entry loads as on a server, and that the
// shortening touched every private name and no public one.
test('the packed package: only what ships, every entry loads, private names short, public names whole', async () => {
  const { unpack, removePacked } = await import('./packed.mjs');
  const { execFileSync } = await import('node:child_process');
  const { existsSync, readdirSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const dir = unpack();
  try {
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const files = walk(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'));
    for (const f of files) assert.match(f, /^(dist\/|bin\/|package\.json$|README\.md$|LICENSE$|CHANGELOG\.md$)/, `${f} is in the package`);
    const targets = Object.values(pkg.exports).flatMap((t) => (typeof t === 'string' ? [t] : Object.values(t)));
    for (const t of targets) assert.ok(existsSync(path.join(dir, t)), `${t} is missing from the package`);
    assert.match(readFileSync(path.join(dir, 'dist/react.js'), 'utf8'), /^'use client';/);

    // In Node, as a server imports them: no window, no document.
    const script = `
      const names = ['index', 'no-gsap', 'manifest', 'debug', 'react', 'vue'];
      const mods = {};
      for (const n of names) mods[n] = await import('./dist/' + n + '.js');
      const F = mods.index.Flythrough;
      console.log(JSON.stringify({
        window: typeof window,
        proto: Object.getOwnPropertyNames(F.prototype),
        statics: Object.getOwnPropertyNames(F),
        same: mods['no-gsap'].Flythrough === F,
        exports: Object.fromEntries(names.map((n) => [n, Object.keys(mods[n]).sort()])),
      }));`;
    const got = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8' }));
    assert.equal(got.window, 'undefined');
    assert.ok(got.same, 'both entries give the same class');
    assert.ok(got.statics.includes('observedAttributes'));
    assert.ok(got.exports.debug.includes('debug') && got.exports.react.includes('Flythrough') && got.exports.vue.includes('Flythrough') && got.exports.manifest.includes('loadManifest'));

    // What a site may call (README, JavaScript) and what the browser calls.
    // (addEventListener, in the reload recipe, is every element's own.)
    const README_API = [...read('README.md').slice(read('README.md').indexOf('## JavaScript')).matchAll(/^player\.(\w+)/gm)].map((m) => m[1]).filter((name) => name !== 'addEventListener');
    const PUBLIC = ['constructor', 'connectedCallback', 'attributeChangedCallback', 'disconnectedCallback', ...new Set(README_API)];
    assert.deepEqual([...new Set(README_API)].sort(), ['goToStop', 'holdLoading', 'position', 'useLenis']);
    for (const name of PUBLIC) assert.ok(got.proto.includes(name), `${name} is not on the built element`);
    // Everything else on it is private: a short name, or one of the few the
    // build keeps as written (it prints which, and why).
    const KEPT = ['set', 'start'];
    const rest = got.proto.filter((name) => !PUBLIC.includes(name));
    const long = rest.filter((name) => !/^[a-zA-Z]\d$/.test(name) && !KEPT.includes(name));
    assert.deepEqual(long, [], 'private members that kept their names in the build');
    // Its private methods (the fields are not on the prototype).
    assert.ok(rest.length > 50, `only ${rest.length} private methods on the built element`);

    // README, "Without a build step": the built files load straight from a
    // CDN. The entry without GSAP imports nothing by name; the default one
    // only the three GSAP modules the README's import map names.
    const named = (entry) => {
      const seen = new Set();
      const bare = new Set();
      const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const text = readFileSync(path.join(dir, 'dist', file), 'utf8');
        // At the start of a line, as the build writes them: not the word
        // in a console message.
        for (const m of text.matchAll(/^(?:import|export)\b[^'";]*?from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm)) {
          const from = m[1] ?? m[2];
          if (from.startsWith('./')) visit(from.slice(2));
          else bare.add(from);
        }
      };
      visit(entry);
      return [...bare].sort();
    };
    assert.deepEqual(named('no-gsap.js'), []);
    assert.deepEqual(named('index.js'), ['gsap', 'gsap/ScrollToPlugin', 'gsap/ScrollTrigger']);
    assert.deepEqual(named('manifest.js'), []);
    assert.deepEqual(named('debug.js'), []);
    const map = read('README.md').match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '{}';
    assert.deepEqual(Object.keys(JSON.parse(map).imports).sort(), named('index.js'));
    for (const file of ['dist/flythrough.css', 'dist/no-gsap.js', 'dist/index.js', 'dist/manifest.js', 'dist/debug.js']) assert.ok(read('README.md').includes(file) && existsSync(path.join(dir, file)), file);

    // The types of every entry are found under each way TypeScript looks a
    // package up: the old one reads typesVersions, the others the exports.
    const ts = (await import('typescript')).default;
    const { cpSync, mkdirSync, writeFileSync } = await import('node:fs');
    const project = path.join(dir, '..', 'types');
    mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    cpSync(dir, path.join(project, 'node_modules', 'flythrough'), { recursive: true });
    const file = path.join(project, 'check.ts');
    writeFileSync(
      file,
      [
        "import { Flythrough, type Stop } from 'flythrough';",
        "import { Flythrough as WithoutGsap } from 'flythrough/no-gsap';",
        "import { loadManifest } from 'flythrough/manifest';",
        "import { debug } from 'flythrough/debug';",
        "import { Flythrough as InReact } from 'flythrough/react';",
        "import { Flythrough as InVue } from 'flythrough/vue';",
        "const stop: Stop = { id: 'a', frame: 1 };",
        'void [Flythrough, WithoutGsap, loadManifest, debug, InReact, InVue, stop];',
        '',
      ].join('\n'),
    );
    const ways = [
      ['node10', { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10 }],
      ['node16', { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 }],
      ['bundler', { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }],
    ];
    for (const [name, how] of ways) {
      const program = ts.createProgram([file], { ...how, target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], ignoreDeprecations: '5.0' });
      const problems = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
      assert.deepEqual(problems, [], `moduleResolution ${name}`);
    }
  } finally {
    removePacked();
  }
});
