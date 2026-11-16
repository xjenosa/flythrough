#!/usr/bin/env node
// The `flythrough` command (package.json "bin"). Plain JS with no build step,
// so `npx flythrough` runs straight from the published files.
import { readFileSync } from 'node:fs';
import { makeFrames, UsageError } from './frames.mjs';

const HELP = `flythrough: tools for the <fly-through> scroll player

Commands
  flythrough frames <video> --out <folder> [options]
      Turn a video into the frames the player plays, plus manifest.json.
      flythrough frames --help lists the options.

  flythrough --version`;

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'frames') await makeFrames(rest);
  else if (cmd === '--version' || cmd === '-v') {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') console.log(HELP);
  else {
    console.error(`Unknown command "${cmd}".\n\n${HELP}`);
    process.exitCode = 1;
  }
} catch (err) {
  if (err instanceof UsageError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
}
