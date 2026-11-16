// A phone's address bar, simulated (after letramy.com's _recon/tour-toolbar.mjs).
// Safari and Chrome show and hide their bar as the visitor scrolls: the
// visible height (innerHeight, 100dvh) changes by the bar's height while the
// large viewport (100lvh) stays put. Emulation has no bar, so the visible
// height is changed by 70 px by hand; where a player measures 100lvh through
// a `.ft__probe` element, that is pinned to the full height, as on a phone.
//   A. resting on stop 3, the bar shows and hides: scroll, frame, stop and
//      card must not move.
//   B. the page opens with the bar showing, the bar hides (what scrolling
//      down does), then the visitor goes to the last stop: it must be
//      reachable and show the last frame. With and without content below.
//   C. the page opens with the bar hidden, the bar shows, same check.
//   node test/toolbar-test.mjs [--root <vite root of a host page>]
import { chromium, devices } from '../tools/tidy-browser.cjs';
import { createServer } from 'vite';
import path from 'node:path';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const root = arg('--root', 'test/host');
const server = await createServer({ root, publicDir: path.resolve('demo/public'), logLevel: 'error', server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch();
const dev = devices['iPhone 14'];
const FULL = dev.viewport.height; // bar hidden: the large viewport
const BAR = 70;
const rows = [];
const check = (name, ok, detail) => rows.push(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(62)} ${detail}`);

const read = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    return {
      y: Math.round(scrollY),
      frame: p.frame,
      stops: p.stopScroll.map((s) => Math.round(p.yFor(s))),
      track: p.track.offsetHeight,
      card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? '-',
      vh: innerHeight,
      max: document.documentElement.scrollHeight - innerHeight,
      last: p.manifest.frames - 1,
    };
  });
const fmt = (s, k) => `scroll ${s.y}, frame ${s.frame}, stop ${k + 1} at ${s.stops[k]}, track ${s.track}, card "${s.card}" (visible height ${s.vh})`;

async function open(qs, height) {
  const ctx = await browser.newContext({ ...dev, viewport: { width: dev.viewport.width, height } });
  // The large viewport does not follow the bar: pin it where a player measures it.
  await ctx.addInitScript((full) => {
    const style = document.createElement('style');
    style.textContent = `.ft__probe { height: ${full}px !important; }`;
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  }, FULL);
  const page = await ctx.newPage();
  await page.goto(`${base}/?lenis=1&intro=1&above=0&${qs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.waitForTimeout(3500);
  return { ctx, page };
}
const resize = async (page, height) => {
  await page.setViewportSize({ width: dev.viewport.width, height });
  await page.waitForTimeout(900);
};

// A. Resting on stop 3; the bar shows, then hides.
{
  const { ctx, page } = await open('', FULL);
  await page.evaluate(() => window.__player.goToStop(2));
  await page.waitForTimeout(4500);
  const a = await read(page);
  await resize(page, FULL - BAR);
  const b = await read(page);
  await resize(page, FULL);
  const c = await read(page);
  console.log('A. resting on stop 3:  ' + fmt(a, 2));
  console.log('   bar shows (-70 px): ' + fmt(b, 2));
  console.log('   bar hides again:    ' + fmt(c, 2));
  const same = (x, y) => x.frame === y.frame && x.y === y.y && x.stops[2] === y.stops[2] && x.card === y.card;
  check('A. on stop 3, bar shows: scroll, frame, stop and card stay', same(a, b), same(a, b) ? 'steady' : 'moved');
  check('A. bar hides again: scroll, frame, stop and card stay', same(a, c), same(a, c) ? 'steady' : 'moved');
  await ctx.close();
}

// B and C. The bar changes after the page opened; then to the last stop.
for (const [letter, openAt, then, what] of [
  ['B', FULL - BAR, FULL, 'opened with the bar showing, bar hides'],
  ['C', FULL, FULL - BAR, 'opened with the bar hidden, bar shows'],
]) {
  for (const [qs, where] of [['below=0', 'player last on the page'], ['', 'content below']]) {
    const { ctx, page } = await open(qs, openAt);
    await resize(page, then);
    await page.evaluate(() => window.__player.goToStop(4));
    await page.waitForTimeout(4800);
    const s = await read(page);
    const ok = Math.abs(s.y - s.stops[4]) <= 1 && s.frame === s.last && s.card === 'overview';
    console.log(`${letter}. ${what}, ${where}: ` + fmt(s, 4) + `, page scrolls to ${s.max}, last frame ${s.last}`);
    check(`${letter}. ${what}, ${where}: last stop reached`, ok, ok ? 'on the stop, last frame' : `${s.stops[4] - s.y} px short, ${s.last - s.frame} frames short`);
    await ctx.close();
  }
}

await browser.close();
await server.close();
console.log('\n' + rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${rows.length - failed} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
