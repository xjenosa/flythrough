// Real input on the host page (after letramy.com's _recon/tour-touch.mjs,
// tour-rest-extra.mjs and tour-load-swipe.mjs), as pass/fail checks.
// Chromium only: finger swipes are compositor gestures sent through CDP
// (Input.dispatchTouchEvent), so a phone coasts after a flick as it does in
// the hand; the network and CPU are slowed through CDP too.
//   phone, real touch, with and without Lenis: back to the first stop from
//     above it; from stops 2 to 4, a swipe either way; a nudge between stops.
//     Where it rests must follow the rest rule: a card showing means resting
//     on its stop, never in the track above the first stop, and between
//     cards it stays where it was left.
//   computer, wheel and keys: label taps from a stop and right after a
//     wheel, one arrow key from a stop, a slow steady scroll through a stop
//     (never pulled back while the visitor keeps going).
//   computer, touchpad momentum against the top, with and without Lenis:
//     the glide back starts half a second after the page stops (Lenis) or
//     as the momentum ends (without), runs to the first stop without being
//     dragged back, and a new flick still takes over. With Lenis also with
//     events merged two frames into one and a sparse tail after.
//   glides cut short: on a phone whose scroll position reads a frame or two
//     late (iOS, WebKit bug 236312), and on a computer with a stray 1 or 2 px
//     wheel event mid-glide (with and without Lenis), a label tap lands on its
//     stop in one go.
//   phone, slow network and CPU, swiping while the loading screen is up: the
//     page is held still, the picture behind the screen stays on frame 0, and
//     once it lifts the intro still plays to the first stop.
//   node test/input-test.mjs
import { chromium, devices } from '../tools/tidy-browser.cjs';
import { serveHost } from './host/serve.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('demo/public/tour/manifest.json')) execFileSync('npm', ['run', 'demo:frames'], { stdio: 'inherit', shell: true });
// --no-gsap: the whole run on the entry without GSAP (test/host/serve.mjs).
const noGsap = process.argv.includes('--no-gsap');
const server = await serveHost({ noGsap });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch();
const rows = [];
const check = (name, ok, detail = '') => rows.push(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(64)} ${detail}`);

// Where the page rests, against the rest rule (see settle in src/flythrough.ts).
const info = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    const top = p.track.getBoundingClientRect().top + scrollY;
    return {
      y: Math.round(scrollY),
      stops: p.stopScroll.map((s) => Math.round(p.yFor(s))),
      card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? null,
      ids: [...p.querySelectorAll('[data-stop]')].map((el) => el.dataset.stop),
      top: Math.round(top),
      end: Math.round(top + p.track.offsetHeight - innerHeight),
      h: innerHeight,
    };
  });
const restVerdict = (s) => {
  const k = s.stops.findIndex((v) => Math.abs(v - s.y) <= 2);
  if (s.card) {
    const want = s.ids.indexOf(s.card);
    return { ok: k === want, text: k === want ? `on stop ${k + 1}, its card showing` : `card "${s.card}" showing ${s.y - s.stops[want]} px off its stop` };
  }
  if (s.y >= s.top - 1 && s.y < s.stops[0] - 2) return { ok: false, text: `rests in the track above the first stop (${s.y})` };
  return { ok: true, text: k >= 0 ? `on stop ${k + 1}` : `between cards at ${s.y}` };
};

async function phone(qs, fn) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const cdp = await ctx.newCDPSession(page);
  const vp = page.viewportSize();
  // dy > 0 moves the page down (a finger dragging up); one screen-half per stroke.
  const swipe = async (dy) => {
    let left = dy;
    const x = Math.round(vp.width / 2);
    while (Math.abs(left) > 1) {
      const step = Math.sign(left) * Math.min(Math.abs(left), vp.height * 0.5);
      const y0 = Math.round(vp.height * (step > 0 ? 0.72 : 0.28));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      const n = Math.max(6, Math.round(Math.abs(step) / 14));
      for (let i = 1; i <= n; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (step * i) / n) }] });
        await page.waitForTimeout(10);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      left -= step;
    }
  };
  try {
    await fn({ page, cdp, swipe, errors });
  } finally {
    await ctx.close();
  }
}
const toY = (page, y) => page.evaluate((y) => (window.__lenis ? window.__lenis.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y)), y);

// ---- phone, real touch
// Without GSAP nothing glides without Lenis (README, Without GSAP): the runs
// with no Lenis are the default entry's only.
const LENIS = noGsap ? [1] : [1, 0];
for (const lenis of LENIS) {
  const tag = `phone, touch, ${lenis ? 'Lenis' : 'no Lenis'}:`;
  await phone(`lenis=${lenis}`, async ({ page, swipe, errors }) => {
    await page.goto(`${base}/?above=0&intro=1&lenis=${lenis}`);
    await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
    await page.waitForTimeout(5000);
    let s = await info(page);
    check(`${tag} the intro ends on the first stop`, Math.abs(s.y - s.stops[0]) <= 2, `at ${s.y}, stop 1 at ${s.stops[0]}`);
    const settle = async () => {
      await page.waitForTimeout(3600);
      return info(page);
    };
    await swipe(-Math.round(s.stops[0] * 0.6));
    s = await settle();
    check(`${tag} swiped up above the first stop: back on it`, Math.abs(s.y - s.stops[0]) <= 2, `at ${s.y}`);
    await swipe(-s.stops[0] - 200);
    s = await settle();
    check(`${tag} swiped to the very top: back on the first stop`, Math.abs(s.y - s.stops[0]) <= 2, `at ${s.y}`);
    for (const k of [1, 2, 3]) {
      for (const dir of [1, -1]) {
        await toY(page, s.stops[k]);
        await page.waitForTimeout(1500);
        await swipe(dir * Math.round(s.h * 0.34));
        s = await settle();
        const v = restVerdict(s);
        check(`${tag} from stop ${k + 1}, swiped ${dir > 0 ? 'down' : 'up'}: rests by the rule`, v.ok, v.text);
      }
    }
    // Between two stops with no card showing: a nudge stays where it ends.
    await toY(page, Math.round((s.stops[1] + s.stops[2]) / 2));
    await page.waitForTimeout(800);
    await swipe(20);
    await page.waitForTimeout(700);
    const nudged = (await info(page)).y;
    s = await settle();
    const v = restVerdict(s);
    check(`${tag} nudged between stops 2 and 3: stays where it ends`, !s.card && Math.abs(s.y - nudged) <= 2 && v.ok, `${nudged} -> ${s.y}, card ${s.card ?? 'none'}`);
    check(`${tag} no page errors`, errors.length === 0, errors.join(' | '));
  });
}

// ---- computer: label taps, keys, a slow steady wheel
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/?above=0&intro=1&lenis=1`);
  await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  const label = (k) => page.locator('.ft__label').nth(k).click();
  const on = (s, k) => Math.abs(s.y - s.stops[k]) <= 2 && s.card === s.ids[k];
  await label(3);
  await page.waitForTimeout(4500);
  let s = await info(page);
  check('computer: label 4 tapped from stop 1: on stop 4, its card showing', on(s, 3), `at ${s.y}, stop 4 at ${s.stops[3]}, card ${s.card}`);
  await label(1);
  await page.waitForTimeout(4500);
  s = await info(page);
  check('computer: then label 2: on stop 2', on(s, 1), `at ${s.y}, card ${s.card}`);
  await page.mouse.move(700, 400);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  await label(4);
  await page.waitForTimeout(4500);
  s = await info(page);
  check('computer: wheeled, then label 5 within half a second: on stop 5', on(s, 4), `at ${s.y}, stop 5 at ${s.stops[4]}, card ${s.card}`);
  await label(1);
  await page.waitForTimeout(3500);
  await page.locator('body').press('ArrowDown');
  await page.waitForTimeout(2600);
  s = await info(page);
  check('computer: one arrow key down from stop 2: pulled back onto it', on(s, 1), `at ${s.y}, stop 2 at ${s.stops[1]}`);
  // 40 px every 120 ms through stop 3's whole card, never pausing half a second.
  const from = s.stops[2] - 500;
  await toY(page, from);
  await page.waitForTimeout(400);
  let back = 0;
  let last = from;
  for (let i = 0; i < 26; i++) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(120);
    const y = (await info(page)).y;
    if (y < last - 2) back++;
    last = y;
  }
  check('computer: slow steady wheel through stop 3: never pulled back', back === 0, `moved backwards ${back} times, ended ${last - s.stops[2]} px past it`);
  await page.waitForTimeout(2600);
  s = await info(page);
  const v = restVerdict(s);
  check('computer: then left alone: rests by the rule', v.ok, v.text);
  check('computer: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- computer, touchpad momentum against the top
// A touchpad keeps sending fading wheel events after the finger lifts, also
// once the page is at the top. They are dispatched in the page, every frame
// (CDP's wheel takes too long per event to be momentum). Without Lenis an
// untrusted wheel event scrolls nothing, so there the flick itself is a real
// (CDP) wheel and only the momentum is dispatched.
// merged: every third frame's event comes with the next one (a browser can
// coalesce them; judged by size it read as a new flick), then a sparse tail
// of 1 px events 150 ms apart (past PUSH_GAP_MS).
for (const [lenis, merged] of [[1, false], [0, false], [1, true]].filter(([l]) => l || !noGsap)) {
  const tag = `computer, touchpad, ${lenis ? 'Lenis' : 'no Lenis'}${merged ? ', merged events' : ''}:`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/?above=0&intro=1&lenis=${lenis}`);
  await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  let s = await info(page);
  const stop = s.stops[0];
  await page.mouse.move(700, 400);
  if (!lenis) {
    await page.mouse.wheel(0, -(stop + 300));
    await page.waitForTimeout(150);
  }
  const r = await page.evaluate(
    async ({ lenis, stop, merged }) => {
      const wheel = (d) => document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const t0 = performance.now();
      const s = [];
      let on = true;
      (function tick() {
        s.push([performance.now() - t0, scrollY]);
        if (on) requestAnimationFrame(tick);
      })();
      if (lenis) for (let i = 0; i < 8; i++) {
        wheel(-120);
        await frame();
      }
      const m0 = performance.now();
      let n = 0;
      let owed = 0;
      while (performance.now() - m0 < 1200) {
        const d = -Math.max(1, 40 * (1 - (performance.now() - m0) / 1200));
        if (merged && ++n % 3 === 0) owed = d;
        else {
          wheel(d + owed);
          owed = 0;
        }
        await frame();
      }
      const mEnd = performance.now() - t0;
      if (merged) for (let i = 0; i < 4; i++) {
        await new Promise((res) => setTimeout(res, 150));
        wheel(-1);
      }
      await new Promise((res) => setTimeout(res, 3500));
      on = false;
      // The glide starts where the page turns back down from its highest point
      // (with Lenis it may still be easing up to the very top by then).
      const minY = Math.min(...s.map(([, y]) => y));
      const top = s.find(([, y]) => y === minY)[0];
      const start = s.find(([t, y]) => t > top && y > minY + 1)?.[0];
      const end = s.find(([t, y]) => t > start && Math.abs(y - stop) <= 2)?.[0];
      let back = 0;
      for (let i = 1; i < s.length; i++) if (s[i][0] > start && s[i][0] <= (end ?? Infinity) && s[i][1] < s[i - 1][1] - 1) back++;
      return { mEnd, start, end, back, final: Math.round(scrollY) };
    },
    { lenis, stop, merged },
  );
  const ms = (n) => (n === undefined ? 'never' : `${Math.round(n)} ms`);
  if (lenis) {
    check(`${tag} flick to the top: glide back starts while momentum still runs`, r.start !== undefined && r.start < r.mEnd, `starts ${ms(r.start)}, momentum ends ${ms(r.mEnd)}`);
  } else {
    const wait = r.start - r.mEnd;
    check(`${tag} flick to the top: glide back starts as the momentum ends`, r.start !== undefined && wait >= 0 && wait < 400, `starts ${ms(r.start)}, momentum ends ${ms(r.mEnd)} (${ms(wait)} after)`);
  }
  check(`${tag} the glide reaches the first stop, never dragged back`, r.end !== undefined && r.back === 0 && Math.abs(r.final - stop) <= 2, `arrives ${ms(r.end)}, moved back ${r.back} times, rests at ${r.final} (stop ${stop})`);
  // From the top, the return replays the opening fly-in: the intro's pace
  // (introSeconds in src/math.ts for the frames from 0 to the first stop).
  // Within 2 px of the stop is reached a little before the ease ends.
  const introMs = await page.evaluate(() => {
    const p = window.__player;
    const frames = Math.round(p.stopList[0].at * (p.manifest.frames - 1));
    return Math.min(2.4, Math.max(0.8, (frames / (p.manifest.fps || 24)) * 1.15)) * 1000;
  });
  const took = r.end - r.start;
  check(`${tag} from the top it flies back at the intro's pace`, took >= introMs * 0.8 && took <= introMs * 1.1, `glide ${ms(took)}, intro ${ms(introMs)}`);
  // A new flick during the glide still takes over: to the top again, then,
  // once the glide back has carried the page past 150 px, stronger and
  // stronger wheel events up. Taken over: Lenis's target follows the flick
  // (190 px up from where the page is) instead of the glide's stop.
  if (lenis) {
    const t = await page.evaluate(async () => {
      const wheel = (d) => document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const until = (ok) => new Promise((res) => (function f() { (ok() ? res : () => requestAnimationFrame(f))(); })());
      for (let i = 0; i < 6; i++) {
        wheel(-120);
        await frame();
      }
      await until(() => scrollY < 20);
      await until(() => scrollY > 150);
      const before = scrollY;
      for (const d of [10, 30, 60, 90]) {
        wheel(-d);
        await frame();
      }
      return { before: Math.round(before), after: Math.round(window.__lenis.targetScroll) };
    });
    check(`${tag} a new flick up during the glide takes over`, t.after <= Math.max(0, t.before - 150), `page at ${t.before}, target after the flick ${t.after}`);
    await page.waitForTimeout(3000);
    s = await info(page);
    check(`${tag} then left alone: back on the first stop`, Math.abs(s.y - stop) <= 2, `at ${s.y}`);
  }
  check(`${tag} no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- glides cut short
// In the page: follow the real scroll position until it reaches the target,
// dispatching one wheel event of `blip` px once 40% of the way is done, and
// say whether it got there in one go (no stand-still of 250 ms on the way).
const TRIP = () => {
  window.__trip = (target, blip) =>
    new Promise((res) => {
      const realY = window.__realY || (() => scrollY);
      const t0 = performance.now();
      const s = [];
      const y0 = realY();
      let blipped = !blip;
      (function f() {
        const t = performance.now() - t0;
        const y = realY();
        s.push([t, y]);
        if (!blipped && Math.abs(y - y0) > Math.abs(target - y0) * 0.4) {
          blipped = true;
          document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: blip, deltaMode: 0, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
        }
        if (Math.abs(y - target) > 2 && t <= 8000) return requestAnimationFrame(f);
        const moving = Math.max(0, s.findIndex(([, v]) => Math.abs(v - y0) > 2));
        let still = 0;
        let from = null;
        for (let i = moving; i < s.length; i++) {
          if (i && Math.abs(s[i][1] - s[i - 1][1]) >= 1) from = null;
          else {
            from ??= s[i][0];
            still = Math.max(still, s[i][0] - from);
          }
        }
        res({ arrived: Math.abs(y - target) <= 2, ms: Math.round(t), still: Math.round(still), y: Math.round(y) });
      })();
    });
};
// iOS can report a position the page had a frame or two before (WebKit bug
// 236312): scrollY and pageYOffset read late on 10% of frames, or on all.
const STALE = (model) => {
  const desc = Object.getOwnPropertyDescriptor(Window.prototype, 'scrollY') || Object.getOwnPropertyDescriptor(window, 'scrollY');
  const real = () => desc.get.call(window);
  window.__realY = real;
  const hist = [real(), real(), real()];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let stale = false;
  (function tick() {
    hist.push(real());
    hist.shift();
    stale = model === 'lag' || rnd() < 0.1;
    requestAnimationFrame(tick);
  })();
  const get = () => (stale ? hist[hist.length - 2] : real());
  Object.defineProperty(window, 'scrollY', { configurable: true, get });
  Object.defineProperty(window, 'pageYOffset', { configurable: true, get });
};
const tripText = (r, stopY, card) => `${r.arrived ? `arrived in ${r.ms} ms` : `stopped at ${r.y} (stop at ${stopY})`}, longest stand-still ${r.still} ms, card ${card}`;

for (const model of noGsap ? [] : ['random', 'lag']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/?above=0&intro=1&lenis=0`);
  await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(STALE, model);
  await page.evaluate(TRIP);
  const g = await info(page);
  for (const k of [3, 1, 4]) {
    const trip = page.evaluate((y) => window.__trip(y), g.stops[k]);
    await page.locator('.ft__label').nth(k).tap();
    const r = await trip;
    await page.waitForTimeout(1200);
    const s = await info(page);
    check(`phone, scroll read late (${model}): label ${k + 1} lands in one go`, r.arrived && r.still < 250 && s.card === s.ids[k], tripText(r, g.stops[k], s.card));
  }
  check(`phone, scroll read late (${model}): no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

for (const lenis of LENIS) {
  const tag = `computer, ${lenis ? 'Lenis' : 'no Lenis'}:`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${base}/?above=0&intro=1&lenis=${lenis}`);
  await page.waitForFunction(() => window.__player?.hasAttribute('ready'), null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(TRIP);
  const g = await info(page);
  for (const [k, blip] of [[3, 1], [1, -1], [4, 2]]) {
    const r = await page.evaluate(([y, k, blip]) => {
      const trip = window.__trip(y, blip);
      window.__player.goToStop(k);
      return trip;
    }, [g.stops[k], k, blip]);
    await page.waitForTimeout(1200);
    const s = await info(page);
    check(`${tag} a ${blip} px wheel blip mid-glide: label ${k + 1} in one go`, r.arrived && r.still < 250 && s.card === s.ids[k], tripText(r, g.stops[k], s.card));
  }
  check(`${tag} glides, no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- phone, slow network and CPU, swiping while the loading screen is up
{
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(() => {
    const s = (window.__s = []);
    const mo = new MutationObserver(() => {
      if (window.__player?.hasAttribute('intro-reveal')) window.__reveal = true;
    });
    mo.observe(document, { attributes: true, subtree: true, attributeFilter: ['intro-reveal'] });
    const tick = () => {
      const p = window.__player;
      if (p && p.querySelector('.ft__loading') && !p.hasAttribute('ready')) s.push({ y: Math.round(scrollY), drawn: p.drawn, key: p.drawnKey });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 12e6 / 8, uploadThroughput: 4e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${base}/?above=0&intro=1&lenis=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => !!document.querySelector('.ft__loading'), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize();
  const x = Math.round(vp.width / 2);
  for (let k = 0; k < 3; k++) {
    const y0 = Math.round(vp.height * 0.72);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (300 * i) / 12) }] });
      await page.waitForTimeout(10);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__player.hasAttribute('ready'), null, { timeout: 120000 });
  const s = await page.evaluate(() => window.__s);
  // The intro at its own pace on a slowed phone: give it time to land.
  const first = await page.evaluate(() => Math.round(window.__player.yFor(window.__player.stopScroll[0])));
  await page.waitForFunction((y) => Math.abs(scrollY - y) <= 2 && !window.__player.opening, first, { timeout: 20000 }).catch(() => {});
  const endY = await page.evaluate(() => Math.round(scrollY));
  const reveal = await page.evaluate(() => !!window.__reveal);
  await ctx.close();
  const ys = [...new Set(s.map((x) => x.y))];
  const keys = s.map((x) => x.key).filter((k, i, a) => k >= 0 && k !== a[i - 1]);
  check('loading, swiping on a slow phone: the page is held still', ys.length === 1, `scroll took ${ys.length} values while loading: ${ys.slice(0, 8).join(' ')}`);
  check('loading: the picture behind the screen is frame 0 only (intro)', keys.length === 1 && s.at(-1)?.drawn === 0, `changed ${keys.length} times (${keys.join(', ')}), last ${s.at(-1)?.drawn}`);
  check('swiped while loading: the intro still plays to the first stop', reveal && Math.abs(endY - first) <= 2, `${reveal ? '' : 'no intro; '}scrollY ${endY}, first stop ${first}`);
}

await browser.close();
await server.close();
console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${rows.length - failed} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
