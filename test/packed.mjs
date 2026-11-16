// The package as npm would publish it: packed (prepack builds dist/, with
// the private names shortened: tools/build.mjs) and unpacked into
// examples/.packed/package. Inside the repo, so that what it imports (gsap,
// react, vue) resolves as it would in a project. The browser tests run on
// src/; test/package.test.mjs and `examples-test.mjs --packed` use this to
// prove the built files.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(root, 'examples', '.packed');

// Packs and unpacks; gives the folder that holds package.json and dist/.
export function unpack() {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execSync(`npm pack --silent --pack-destination "${dir}"`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack wrote no tarball');
  // By its bare name from its own folder: GNU tar reads a colon in a path
  // (C:\...) as a remote host.
  execFileSync('tar', ['-xzf', tarball], { cwd: dir });
  return path.join(dir, 'package');
}

export const removePacked = () => rmSync(dir, { recursive: true, force: true });
