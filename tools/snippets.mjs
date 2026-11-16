// README.md's framework code is not written by hand: it is cut from the
// example projects that test/examples-test.mjs builds and runs. In the
// README, a pair of markers names the source:
//
//   <!-- snippet: examples/react/src/Tour.tsx -->        (the whole file)
//   <!-- snippet: examples/react/src/App.tsx#usage -->   (a region of it)
//   ...a fenced code block, rewritten by this script...
//   <!-- /snippet -->
//
// A region is the lines between `#region usage` and `#endregion usage`
// comments in the source, without those two lines, shifted left.
//   node tools/snippets.mjs           rewrite README.md
//   node tools/snippets.mjs --check   fail if README.md is out of date
// test/snippets.test.mjs runs the check with the unit tests.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LANG = { '.tsx': 'tsx', '.ts': 'ts', '.mjs': 'js', '.js': 'js', '.vue': 'vue', '.svelte': 'svelte', '.html': 'html' };
const BLOCK = /<!-- snippet: (\S+) -->\n[\s\S]*?<!-- \/snippet -->/g;

export function cut(spec) {
  const [file, region] = spec.split('#');
  if (!file.startsWith('examples/')) throw new Error(`snippet ${spec}: only files under examples/ are built and tested`);
  let lines = readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (region) {
    const from = lines.findIndex((l) => new RegExp(`#region ${region}\\b`).test(l));
    const to = lines.findIndex((l) => new RegExp(`#endregion ${region}\\b`).test(l));
    if (from < 0 || to < from) throw new Error(`snippet ${spec}: no "#region ${region}" ... "#endregion ${region}" in ${file}`);
    lines = lines.slice(from + 1, to);
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    lines = lines.map((l) => l.slice(indent));
  }
  return `\`\`\`${LANG[path.extname(file)] ?? ''}\n${lines.join('\n')}\n\`\`\``;
}

// The README with every snippet block filled from its source, and the
// sources named.
export function fill(readme) {
  const sources = [];
  const text = readme.replace(/\r\n/g, '\n').replace(BLOCK, (_, spec) => {
    sources.push(spec);
    return `<!-- snippet: ${spec} -->\n${cut(spec)}\n<!-- /snippet -->`;
  });
  return { text, sources };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(ROOT, 'README.md');
  const before = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const { text, sources } = fill(before);
  if (process.argv.includes('--check')) {
    if (text !== before) {
      console.error('README.md snippets are out of date: run `npm run snippets`');
      process.exitCode = 1;
    }
  } else {
    writeFileSync(file, text);
    console.log(`README.md: ${sources.length} snippets from ${new Set(sources.map((s) => s.split('#')[0])).size} example files`);
  }
}
