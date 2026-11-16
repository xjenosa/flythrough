// Screenshots of the built demo (npm run demo:build first), computer and
// phone: the intro, the loading screen, each stop, a passing moment and the
// content below. Playwright's own Chromium, temporary profile.
//   node tools/shots.mjs <out-folder> ["<query>"]
// The query goes to the demo page, e.g. "loading=plain&glide=scaled".
import { chromium, devices } from './tidy-browser.cjs';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/shots.mjs <out-folder> ["<query>"]');
const query = process.argv[3] ? `&${process.argv[3]}` : '';
mkdirSync(out, { recursive: true });
const server = await preview({ root: 'demo', preview: { port: 0 }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();

for (const [dev, opts] of [
  ['computer', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ['phone', { ...devices['iPhone 14'] }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Slow frames, so the loading screen is up long enough to photograph.
  await page.route('**/tour/**/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 200));
    route.continue().catch(() => {});
  });
  // Not 'load': frames already in flight when it would fire hold it back.
  await page.goto(`${base}?lenis=0${query}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${dev}-0-intro.png`) });
  await page.evaluate(() => window.scrollTo(0, document.querySelector('fly-through').getBoundingClientRect().top + scrollY));
  await page.waitForFunction(() => Number(document.querySelector('.ft__loading-num')?.textContent) >= 40 || document.querySelector('fly-through')?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.screenshot({ path: path.join(out, `${dev}-0b-loading.png`) });
  await page.waitForFunction(() => document.querySelector('fly-through')?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.unroute('**/tour/**/*.webp');
  const ys = await page.evaluate(() => {
    const p = document.querySelector('fly-through');
    return p.stopScroll.map((s) => Math.round(p.yFor(s)));
  });
  for (let k = 0; k < ys.length; k++) {
    await page.evaluate((y) => window.scrollTo(0, y), ys[k]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `${dev}-${k + 1}-stop.png`) });
  }
  // The first passing moment: the middle of where it shows between stops 2 and 3.
  const on = [];
  for (let i = 0; i <= 40; i++) {
    const y = Math.round(ys[1] + ((ys[2] - ys[1]) * i) / 40);
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(40);
    if (await page.evaluate(() => !!document.querySelector('[data-moment][data-active]'))) on.push(y);
  }
  if (on.length) {
    await page.evaluate((y) => window.scrollTo(0, y), on[Math.floor(on.length / 2)]);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${dev}-2b-moment.png`) });
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${dev}-9-below.png`) });
  if (errors.length) console.log(dev, 'page errors:', errors);
  await ctx.close();
}
await browser.close();
await server.close();
console.log(`shots in ${out}`);
