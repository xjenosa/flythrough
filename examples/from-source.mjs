// The examples import the package by its name, as a project that installed
// it would; here those names lead to this repo's source. Used as
// resolve.alias in each example's vite.config.mjs. (examples/next and
// examples/nuxt install the packed package instead: test/examples-test.mjs.)
//
// FLYTHROUGH_PACKED (test/examples-test.mjs --packed): the folder of the
// unpacked package (test/packed.mjs). The names then lead to its built
// files, as they would from node_modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packed = process.env.FLYTHROUGH_PACKED;
const file = (name) => {
  const css = name === 'flythrough.css';
  if (packed) return path.join(packed, 'dist', css ? name : `${name}.js`);
  return fileURLToPath(new URL(`../src/${css ? name : `${name}.ts`}`, import.meta.url));
};

export const flythroughFromSource = [
  { find: /^flythrough\/style\.css$/, replacement: file('flythrough.css') },
  { find: /^flythrough\/manifest$/, replacement: file('manifest') },
  { find: /^flythrough\/debug$/, replacement: file('debug') },
  { find: /^flythrough\/react$/, replacement: file('react') },
  { find: /^flythrough\/vue$/, replacement: file('vue') },
  { find: /^flythrough\/no-gsap$/, replacement: file('no-gsap') },
  { find: /^flythrough$/, replacement: file('index') },
];
