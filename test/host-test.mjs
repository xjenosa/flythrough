// The player on a host page with content above and below it (test/host/),
// with and without Lenis, computer (wheel) and phone (real touch through CDP).
// Each case leaves the scroll somewhere, then watches 3 s: does it stay, or
// glide, from when, how long, and where to. Serves the page itself (Vite)
// with the demo frames, made first if missing.
//   node test/host-test.mjs [--browser chromium|firefox|webkit]
// Firefox and WebKit run the computer cases only (touch goes through CDP).
import { chromium, firefox, webkit, devices } from '../tools/tidy-browser.cjs';
import { serveHost } from './host/serve.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const which = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chromium';
const engine = { chromium, firefox, webkit }[which];
if (!engine) throw new Error(`unknown browser ${which}`);
if (!existsSync('demo/public/tour/manifest.json')) execFileSync('npm', ['run', 'demo:frames'], { stdio: 'inherit', shell: true });
// --no-gsap: the whole run on the entry without GSAP (test/host/serve.mjs).
const noGsap = process.argv.includes('--no-gsap');
const server = await serveHost({ noGsap });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await engine.launch();
const rows = [];

// Without GSAP every glide is Lenis's, so there is no run without Lenis.
for (const lenis of noGsap ? [1] : [1, 0]) {
  for (const dev of which === 'chromium' ? ['computer', 'phone'] : ['computer']) {
    const phone = dev === 'phone';
    const ctx = await browser.newContext(phone ? { ...devices['iPhone 14'] } : { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    const cdp = phone ? await ctx.newCDPSession(page) : null;
    const vp = page.viewportSize();

    const open = async (qs) => {
      await page.goto(`${base}/?lenis=${lenis}&${qs}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
      await page.waitForTimeout(3500); // any intro glide is over
    };
    const info = () => page.evaluate(() => {
      const p = window.__player;
      const span = p.track.offsetHeight - innerHeight;
      return { y: Math.round(scrollY), top: Math.round(p.trackTop()), span, vh: innerHeight, stops: p.stopScroll.map((s) => Math.round(p.yFor(s))), max: document.documentElement.scrollHeight - innerHeight, card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? '-' };
    });
    const place = async (y) => {
      await page.evaluate((y) => { if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); }, y);
      await page.waitForTimeout(80);
    };
    // A small real gesture where the scroll is, so the rest rule hears a visitor.
    const nudge = async (dy) => {
      if (!phone) { await page.mouse.move(vp.width / 2, vp.height / 2); await page.mouse.wheel(0, dy); return; }
      const x = Math.round(vp.width / 2); const y0 = Math.round(vp.height * 0.6);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (dy * i) / 8) }] }); await page.waitForTimeout(16); }
      await page.waitForTimeout(120); // finger held: no coasting
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // Watch for 3 s after the last input.
    const watch = async () => {
      const trail = await page.evaluate(() => new Promise((done) => {
        const t0 = performance.now(); const out = [];
        const tick = () => { const t = performance.now() - t0; out.push([Math.round(t), Math.round(scrollY)]); if (t < 3000) requestAnimationFrame(tick); else done(out); };
        requestAnimationFrame(tick);
      }));
      const y0 = trail[0][1];
      // Ignore the gesture's own tail (Lenis easing a wheel notch, finger coast): a glide is a move > 4 px after 300 ms.
      const settledTail = trail.find(([t]) => t >= 300)?.[1] ?? y0;
      const startIdx = trail.findIndex(([t, y]) => t >= 300 && Math.abs(y - settledTail) > 4);
      const end = trail.at(-1)[1];
      if (startIdx < 0) return { moved: false, end };
      let stopIdx = trail.length - 1;
      while (stopIdx > startIdx && Math.abs(trail[stopIdx - 1][1] - end) <= 1) stopIdx--;
      return { moved: true, start: trail[startIdx][0], dur: trail[stopIdx][0] - trail[startIdx][0], end };
    };
    const where = (s, y) => {
      if (y < s.top - 1) return 'host content above';
      if (y > s.top + s.span + 1) return 'host content below';
      const k = s.stops.findIndex((v) => Math.abs(v - y) <= 2);
      return k >= 0 ? `stop ${k + 1}` : `track, off a stop`;
    };
    const run = async (name, expect, y, dy) => {
      await place(y);
      await nudge(dy);
      // Where the gesture itself was heading (Lenis eases a wheel notch out
      // over ~0.7 s): only a move away from there is a glide.
      const aim = await page.evaluate(() => (window.__lenis ? Math.round(window.__lenis.targetScroll) : null));
      const w = await watch();
      if (w.moved && aim !== null && Math.abs(w.end - aim) <= 4) w.moved = false;
      const s = await info();
      const got = w.moved ? `glides to ${where(s, w.end)} (starts ${w.start} ms, lasts ${w.dur} ms)` : `stays (${where(s, w.end)})`;
      const ok = expect === 'stays' ? !w.moved : w.moved && where(s, w.end) === expect;
      rows.push(`${ok ? 'ok  ' : 'FAIL'} ${lenis ? 'Lenis   ' : 'no Lenis'} ${dev.padEnd(8)} ${name.padEnd(44)} ${got}`);
    };

    // On load: does the player move the page as it loads (autoscroll)?
    for (const [name, qs, expect] of [
      ['load, content above, intro', 'intro=1', 'stays at the top'],
      ['load, content above, no intro', '', 'stays at the top'],
      ['load, content above, intro, autoscroll="on" (dropped)', 'intro=1&autoscroll=on', 'stays at the top'],
      ['load, player first, intro', 'intro=1&above=0', 'stop 1'],
      ['load, player first, intro, autoscroll="off"', 'intro=1&above=0&autoscroll=off', 'stays at the top'],
    ]) {
      await open(qs);
      const s0 = await info();
      const got = s0.y === 0 ? 'stays at the top' : where(s0, s0.y);
      rows.push(`${got === expect ? 'ok  ' : 'FAIL'} ${lenis ? 'Lenis   ' : 'no Lenis'} ${dev.padEnd(8)} ${name.padEnd(44)} ${got}`);
    }

    // Host content above and below; no intro, so return-to-first is off.
    await open('');
    let s = await info();
    await run('rest in host content above', 'stays', Math.round(s.top * 0.5), 40);
    await run('rest in host content below', 'stays', s.top + s.span + Math.round(s.vh * 0.5), 40);
    await run('rest near stop 2, its card showing', 'stop 2', s.stops[1] + Math.round(s.vh * 0.2), 40);
    await run('rest between stops 2 and 3 (no card)', 'stays', Math.round((s.stops[1] + s.stops[2]) / 2), 40);
    await run('rest just inside the track, return off', 'stays', s.top + 2, 1);

    // intro (return-to-first on by default), nothing above, content below.
    await open('intro=1&above=0');
    s = await info();
    await run('intro: rest above stop 1 in the track', 'stop 1', s.top + 4, 1);
    await run('intro: rest in host content below', 'stays', s.top + s.span + Math.round(s.vh * 0.5), 40);
    await run('intro: rest near stop 3, its card showing', 'stop 3', s.stops[2] - Math.round(s.vh * 0.2), 40);

    await open('intro=1&above=0&return=off');
    s = await info();
    await run('return-to-first="off": rest at the very top', 'stays', s.top + 4, 1);

    await open('intro=1&above=0&snap=off');
    s = await info();
    await run('snap="off": rest near stop 2', 'stays', s.stops[1] + Math.round(s.vh * 0.2), 40);
    await run('snap="off": rest at the very top', 'stop 1', s.top + 4, 1);

    // How long the rest rule's glide is asked to take: 1.1 s however far by
    // default; with glide="scaled", 0.6 s plus 0.8 s per screen travelled, at
    // most 1.4 s. The return to the first stop from above it is the intro's
    // pace either way (introSeconds in src/math.ts for the frames it crosses,
    // read from the flight position where the glide starts; a frame's slack).
    // A label tap keeps its own timing either way. Read where every glide
    // passes (glideTo), so it holds with and without Lenis.
    for (const scaled of [false, true]) {
      await open(`intro=1&above=0${scaled ? '&glide=scaled' : ''}`);
      s = await info();
      await page.evaluate(() => {
        const p = window.__player;
        window.__glides = [];
        const glideTo = p.glideTo.bind(p);
        p.glideTo = (y, d, e) => {
          window.__glides.push({ y, d, from: window.__lenis ? window.__lenis.targetScroll : scrollY, vh: innerHeight, prog: p.progress, first: p.stopList[0].at, frames: p.manifest.frames, fps: p.manifest.fps || 24 });
          return glideTo(y, d, e);
        };
      });
      const tag = scaled ? 'glide="scaled"' : 'glide default';
      const timed = async (name, y, dy, intro = false) => {
        await page.evaluate(() => (window.__glides.length = 0));
        await place(y);
        await nudge(dy);
        await page.waitForTimeout(intro ? 3400 : 2700);
        const g = await page.evaluate(() => window.__glides[0]);
        const end = (await info()).y;
        const want = !g ? null : intro ? Math.min(2.4, Math.max(0.8, (Math.round(Math.abs(g.first - g.prog) * (g.frames - 1)) / g.fps) * 1.15)) : scaled ? Math.min(1.4, 0.6 + (0.8 * Math.abs(g.y - g.from)) / g.vh) : 1.1;
        const ok = !!g && Math.abs(g.d - want) < (intro ? 0.06 : 0.005) && Math.abs(end - g.y) <= 2;
        rows.push(`${ok ? 'ok  ' : 'FAIL'} ${lenis ? 'Lenis   ' : 'no Lenis'} ${dev.padEnd(8)} ${`${tag}: ${name}`.padEnd(44)} ${g ? `${Math.round(Math.abs(g.y - g.from))} px in ${g.d.toFixed(2)} s (expected ${want.toFixed(2)} s), arrives` : 'no glide'}`);
      };
      await timed('short pull to stop 2', s.stops[1] + Math.round(s.vh * 0.1), 20);
      await timed('return to stop 1 from the top', s.top + 4, 1, true);
      await timed('long pull to stop 5, card early', s.stops[4] - Math.round(s.vh * 0.5), 20);
      const tap = await page.evaluate(() => {
        const p = window.__player;
        window.__glides.length = 0;
        const from = p.scrollPos;
        document.querySelectorAll('.ft__label')[1].click();
        return { d: window.__glides[0]?.d, want: Math.min(3, 0.8 + Math.abs(from - p.stopScroll[1]) * 2.4) };
      });
      await page.waitForTimeout(3200);
      rows.push(`${tap.d !== undefined && Math.abs(tap.d - tap.want) < 0.005 ? 'ok  ' : 'FAIL'} ${lenis ? 'Lenis   ' : 'no Lenis'} ${dev.padEnd(8)} ${`${tag}: label tap keeps its own timing`.padEnd(44)} ${tap.d?.toFixed(2)} s (expected ${tap.want.toFixed(2)} s)`);
    }

    // Without Lenis on a computer: a wheel mid-glide takes over, and a label
    // tap's glide is never cut short by the rest rule.
    if (!lenis && !phone) {
      await open('intro=1&above=0');
      s = await info();
      await place(s.stops[1] + Math.round(s.vh * 0.2));
      await nudge(40);
      await page.waitForTimeout(800); // the settle glide is under way
      const before = (await info()).y;
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);
      const after = (await info()).y;
      const w = await watch();
      const end = await info();
      rows.push(`${after > before + 300 ? 'ok  ' : 'FAIL'} no Lenis computer ${'wheel during a settle glide takes over'.padEnd(44)} y ${before} -> ${after} after the wheel, then ${w.moved ? `glides to ${where(end, w.end)}` : `stays (${where(end, w.end)})`}`);
      await place(s.stops[0]);
      await page.waitForTimeout(1500);
      const trail = await page.evaluate(() => new Promise((done) => {
        document.querySelectorAll('.ft__label')[2].click();
        const t0 = performance.now(); const out = [];
        const tick = () => { const t = performance.now() - t0; out.push(Math.round(scrollY)); if (t < 4500) requestAnimationFrame(tick); else done(out); };
        requestAnimationFrame(tick);
      }));
      let back = 0;
      for (let i = 1; i < trail.length; i++) if (trail[i] < trail[i - 1] - 1) back++;
      const fin = await info();
      rows.push(`${back === 0 && where(fin, trail.at(-1)) === 'stop 3' ? 'ok  ' : 'FAIL'} no Lenis computer ${'label tap to stop 3, never pulled back'.padEnd(44)} ends at ${where(fin, trail.at(-1))}, ${back} backward steps`);
    }
    if (errors.length) rows.push(`     page errors: ${errors.join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
await server.close();
console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL') || r.includes('page errors')).length;
console.log(`\n${which}${noGsap ? ', no GSAP' : ''}: ${rows.filter((r) => r.startsWith('ok')).length} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

