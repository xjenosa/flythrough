// Browser checks on the host page (test/host/) for: lazy start, stills on a
// data saver or 2G, the poster, AVIF frames, attribute names against the
// element's properties, and what the final review fixed (a script that runs
// early, src set late, a page margin, opening away from the player's top,
// the page hold, the picture at rest, a host that stops answering, a drop
// of the connection, a waiting player above the visitor, content above
// that changes height, wrong turns said in the console, "false" for off,
// the reload recipe).
//   node test/features-test.mjs [--browser chromium|firefox|webkit]
import { chromium, firefox, webkit } from '../tools/tidy-browser.cjs';
import { serveHost } from './host/serve.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeFrames } from '../bin/frames.mjs';

const which = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : 'chromium';
const engine = { chromium, firefox, webkit }[which];
if (!engine) throw new Error(`unknown browser ${which}`);
if (!existsSync('demo/public/tour/manifest.json')) execFileSync('npm', ['run', 'demo:frames'], { stdio: 'inherit', shell: true });
// static.html links the package stylesheet as a plain file, so it applies
// with scripting off.
// A short AVIF tour, made here by the frame maker from the demo footage
// (its first four seconds, 48 frames), is served under /avif/.
const avifDir = mkdtempSync(path.join(tmpdir(), 'flythrough-avif-'));
let avifMade = '';
try {
  await makeFrames(['demo/footage/grey-flight.mp4', '--out', avifDir, '--set', 'small=640', '--to', '4', '--frames', '48', '--format', 'avif'], () => {});
} catch (err) {
  avifMade = String(err.message ?? err).slice(0, 200);
}
const stylesheet = {
  name: 'package-stylesheet',
  configureServer(s) {
    s.middlewares.use('/flythrough.css', (_req, res) => {
      res.setHeader('content-type', 'text/css');
      res.end(readFileSync('src/flythrough.css'));
    });
    s.middlewares.use('/avif', (req, res) => {
      const file = path.join(avifDir, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(avifDir) || !existsSync(file)) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'image/avif');
      res.end(readFileSync(file));
    });
    // A page that arrives in two parts: the player's start tag, then (once
    // its script, early.ts, has run and says so) its children and the rest.
    // The script is imported from the head, so it does not wait for the
    // page. (Not an async script: Playwright's WebKit holds those back
    // until the page is in; Chromium and Firefox run them as they arrive.)
    let go;
    s.middlewares.use('/stream', async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/go') {
        go?.();
        return res.end('ok');
      }
      const mode = url.searchParams.get('mode');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write(
        `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/flythrough.css"><style>html,body{margin:0}</style><script>import("/early.ts")</script></head><body><!--${'x'.repeat(4096)}--><fly-through id="player" src="/tour/manifest.json"${mode ? ` mode="${mode}"` : ''}>`,
      );
      await Promise.race([new Promise((r) => (go = r)), new Promise((r) => setTimeout(r, 15000))]);
      res.end(
        '<img data-poster src="/tour/landscape/0049.webp" alt=""><div data-stop="a" data-frame="49" data-label="A">Card A <i data-progress id="meter"></i></div><div data-stop="b" data-frame="300" data-label="B">Card B</div><p data-moment="m" data-from="0.2" data-to="0.3">Moment</p></fly-through><section style="height:150vh">below</section></body></html>',
      );
    });
  },
};
const server = await serveHost({ plugins: [stylesheet] });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await engine.launch();
const rows = [];
const COMPUTER = { viewport: { width: 1440, height: 900 } };

async function session(opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  // Every request for the tour's files (manifest and frames), in order.
  const asked = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  // Not Firefox's own note about pages that move with the scroll.
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && !m.text().includes('scroll-linked') && warnings.push(m.text()));
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/tour/')) asked.push(p);
  });
  try {
    await fn(page, { errors, warnings, asked, ctx });
  } finally {
    await ctx.close();
  }
}

function check(name, ok, detail = '') {
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(62)} ${detail}`);
}
const ready = (page, sel = 'window.__player', timeout = 30000) =>
  page.waitForFunction((s) => eval(s)?.hasAttribute('ready'), sel, { timeout }).then(() => true, () => false);
const scrollTo = async (page, screens) => {
  await page.evaluate((s) => window.scrollTo(0, Math.round(innerHeight * s)), screens);
  await page.waitForTimeout(500);
};

// ---- lazy start
// The content above is four screens, so the player's top is three screens
// below the bottom of the screen: more than the two it waits for.
await session(COMPUTER, async (page, { errors, asked }) => {
  await page.goto(`${base}/?aboveh=400&intro=1`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const p = window.__player;
    return { ready: p.hasAttribute('ready'), h: p.offsetHeight, vh: innerHeight, veil: !!p.querySelector('.ft__loading'), pos: p.position };
  });
  check('lazy start: a player far down the page asks for nothing', asked.length === 0 && !r.ready && r.pos === null, `${asked.length} requests`);
  check('lazy start: it waits as one screen under its loading screen', r.veil && r.h === r.vh, `height ${r.h}, screen ${r.vh}`);
  await scrollTo(page, 0.9);
  check('lazy start: still nothing just over two screens away', asked.length === 0, `${asked.length} requests`);
  await scrollTo(page, 1.2);
  const ok = await ready(page);
  const after = await page.evaluate(() => ({ y: Math.round(scrollY), want: Math.round(innerHeight * 1.2), h: window.__player.offsetHeight, vh: innerHeight }));
  check('lazy start: it loads within two screens, the manifest first', ok && asked[0] === '/tour/manifest.json' && after.h > after.vh * 3, `first request ${asked[0]}, height ${after.h}`);
  check('lazy start: loading does not move the page', after.y === after.want, `y ${after.y}, left at ${after.want}`);
  check('lazy start: no page errors', errors.length === 0, errors.join(' | '));
});

// Within two screens: at once, as before.
await session(COMPUTER, async (page, { asked }) => {
  await page.goto(`${base}/?aboveh=290`, { waitUntil: 'load' });
  const ok = await ready(page);
  const y = await page.evaluate(() => scrollY);
  check('lazy start: a player within two screens starts at once', ok && y === 0 && asked[0] === '/tour/manifest.json', `scrollY ${y}`);
});

// A reload (or back, forward): the browser restores the scroll, which needs
// the page at its full height, so nothing waits.
await session(COMPUTER, async (page, { asked }) => {
  await page.goto(`${base}/?aboveh=400`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const before = asked.length;
  await page.reload({ waitUntil: 'load' });
  const ok = await ready(page);
  check('lazy start: on a reload the player starts at once', before === 0 && ok, `${before} requests before the reload`);
});

await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?aboveh=400&position=0.5`, { waitUntil: 'load' });
  const ok = await ready(page);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ y: Math.round(scrollY), want: Math.round(window.__player.yFor(0.5)) }));
  check('lazy start: a position set before boot starts it and opens there', ok && Math.abs(r.y - r.want) <= 2, `y ${r.y}, want ${r.want}`);
});

await session(COMPUTER, async (page, { errors, asked }) => {
  await page.goto(`${base}/?aboveh=400`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const p = window.__player;
    const next = p.nextSibling;
    p.remove();
    document.body.insertBefore(p, next);
  });
  await page.waitForTimeout(600);
  const waited = asked.length === 0;
  await scrollTo(page, 1.2);
  const ok = await ready(page);
  check('lazy start: removed and put back while waiting, it still waits, then loads', waited && ok && errors.length === 0, errors.join(' | '));
});

// Stills wait the same way.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { asked }) => {
  await page.goto(`${base}/?aboveh=400`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const before = asked.length;
  await scrollTo(page, 1.2);
  const ok = await ready(page);
  const stills = await page.evaluate(() => document.querySelectorAll('.ft__still img').length);
  check('lazy start: stills far down wait too', before === 0 && ok && stills === 5, `${before} requests before, ${stills} stills`);
});

// ---- a data saver, a 2G connection
// navigator.connection is Chromium's only; defined here for every engine.
const connection = (c) => Object.defineProperty(Navigator.prototype, 'connection', { get: () => c, configurable: true });
for (const [name, conn, qs, want] of [
  ['a data saver gets stills', { saveData: true, effectiveType: '4g' }, '', true],
  ['a 2G connection gets stills', { saveData: false, effectiveType: '2g' }, '', true],
  ['a 3G connection gets the flight', { saveData: false, effectiveType: '3g' }, '', false],
  ['mode="scrub" keeps the flight on a data saver', { saveData: true, effectiveType: '2g' }, '&mode=scrub', false],
]) {
  await session(COMPUTER, async (page, { errors, asked }) => {
    await page.addInitScript(connection, conn);
    await page.goto(`${base}/?above=0${qs}`, { waitUntil: 'load' });
    const ok = await ready(page);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ stills: window.__player.hasAttribute('stills'), canvas: !!document.querySelector('canvas'), cards: document.querySelectorAll('.ft__still > [data-stop]').length }));
    const frames = asked.filter((p) => p.endsWith('.webp')).length;
    const right = want ? r.stills && !r.canvas && r.cards === 5 && frames <= 5 : !r.stills && r.canvas && frames > 5;
    check(name, ok && right && errors.length === 0, `stills ${r.stills}, ${frames} frames asked for`);
  });
}

// ---- the poster (test/host/static.html: the player written as HTML)
const posterState = (page) =>
  page.evaluate(() => {
    const p = document.getElementById('player');
    const poster = document.querySelector('[data-poster]');
    const img = poster?.matches('img') ? poster : poster?.querySelector('img');
    const box = poster?.getBoundingClientRect();
    const hit = poster ? document.elementFromPoint(innerWidth / 2, innerHeight / 3) : null;
    return {
      there: !!poster,
      inStage: !!poster?.closest('.ft__stage'),
      fills: !!box && Math.round(box.top) === 0 && Math.round(box.width) === innerWidth && Math.round(box.height) === innerHeight,
      loaded: !!img && img.complete && img.naturalWidth > 0,
      src: img?.currentSrc.split('/').slice(-2).join('/') ?? '',
      fit: img ? getComputedStyle(img).objectFit : '',
      // What is on top at a point of the picture: the poster, or what covers it.
      top: hit === poster || hit === img ? 'poster' : (hit?.className || hit?.tagName || 'nothing'),
      cards: [...p.querySelectorAll('[data-stop], [data-moment]')].map((c) => getComputedStyle(c).visibility).join(','),
      drawn: p.drawn ?? null,
      h: p.offsetHeight,
    };
  });

// Scripting off: the poster is the picture, the stops are the page's content.
await session({ ...COMPUTER, javaScriptEnabled: false }, async (page) => {
  await page.goto(`${base}/static.html`, { waitUntil: 'load' });
  // No page.evaluate without scripting: read through locators.
  const poster = page.locator('[data-poster]');
  const box = await poster.boundingBox();
  const vp = page.viewportSize();
  const card = await page.locator('[data-stop="entrance"]').boundingBox();
  const shown = await page.locator('[data-stop="entrance"]').isVisible();
  const moment = await page.locator('[data-moment]').isVisible();
  check('scripting off: the poster fills the first screen', !!box && box.y === 0 && Math.round(box.width) === vp.width && Math.round(box.height) === vp.height, JSON.stringify(box));
  check('scripting off: the stops and moments show below it, as page content', shown && moment && !!card && card.y >= vp.height, `card at y ${card?.y}`);
});

// Before the player's script has run: the poster shows, the stops wait hidden.
// The poster here is frame 50, not the opening frame 49: a browser that
// loads frames as images (WebKit) takes the opening frame straight from the
// poster's cache, draws it, and the poster is gone before it can be looked at.
await session(COMPUTER, async (page, { errors }) => {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/src/index.ts', async (route) => {
    await held;
    route.continue().catch(() => {});
  });
  // static.html's own poster is frame 49: refused, so it is in no cache.
  let holdFrames = false;
  let frames;
  const framesHeld = new Promise((r) => (frames = r));
  await page.route('**/tour/landscape/*.webp', async (route) => {
    if (!holdFrames) return route.request().url().endsWith('/0049.webp') ? route.abort() : route.continue();
    await framesHeld;
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/static.html?n=0050`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__player && document.querySelector('[data-poster]')?.complete && document.querySelector('[data-poster]').src.endsWith('0050.webp'), null, { timeout: 15000 });
  const before = await posterState(page);
  check('before the script: the poster fills the first screen', before.there && !before.inStage && before.fills && before.loaded && before.top === 'poster', JSON.stringify(before));
  check('before the script: stops and moments stay hidden', before.cards === 'hidden,hidden,hidden,hidden', before.cards);

  // The player starts, its frames held back: the poster sits in the stage,
  // over the undrawn canvas, under the loading screen.
  holdFrames = true;
  release();
  await page.waitForFunction(() => !!document.querySelector('.ft__loading') && window.__player.booted, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const loading = await posterState(page);
  const order = await page.evaluate(() => [...document.querySelector('.ft__stage').children].map((c) => (c.hasAttribute('data-poster') ? 'poster' : c.className.split(' ')[0])).join(' '));
  check('loading: the poster is in the stage, over the canvas, under the loading screen', loading.inStage && loading.fills && loading.drawn === -1 && loading.top === 'ft__loading' && order.startsWith('ft__canvas poster ') && order.endsWith('ft__loading'), `${order}; ${JSON.stringify(loading)}`);
  frames();
  const ok = await ready(page);
  await page.waitForTimeout(300);
  const after = await posterState(page);
  check('once a frame is drawn the poster is gone', ok && !after.there && after.drawn >= 0, JSON.stringify(after));
  check('poster: no page errors', errors.length === 0, errors.join(' | '));
});

// A <picture> poster gives an upright phone its own frame; fit="contain"
// shows the whole picture, as the canvas will.
await session({ viewport: { width: 390, height: 780 } }, async (page) => {
  // The poster first, then the player with its frames held back (WebKit
  // would queue the poster behind them).
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/src/index.ts', async (route) => {
    await held;
    route.continue().catch(() => {});
  });
  await page.route('**/tour/portrait/*.webp', (route) => (route.request().url().endsWith('/0050.webp') ? route.continue() : new Promise(() => {})));
  await page.goto(`${base}/static.html?picture=1&n=0050&fit=contain`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('[data-poster] img')?.complete, null, { timeout: 15000 });
  release();
  await page.waitForFunction(() => window.__player?.booted, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const r = await posterState(page);
  check('a <picture> poster: the portrait frame on an upright screen, filling the stage', r.inStage && r.fills && r.loaded && r.src === 'portrait/0050.webp', JSON.stringify(r));
  check('fit="contain": the poster is fitted the same way', r.fit === 'contain', r.fit);
});

// A player waiting far down the page (lazy start) shows its poster.
await session(COMPUTER, async (page, { asked }) => {
  await page.goto(`${base}/static.html?aboveh=400`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const poster = document.querySelector('[data-poster]');
    return { inStage: !!poster?.closest('.ft__stage'), loaded: poster?.complete && poster.naturalWidth > 0, h: Math.round(poster?.getBoundingClientRect().height ?? 0), vh: innerHeight };
  });
  const frames = asked.filter((p) => p !== '/tour/landscape/0049.webp');
  check('lazy start: a waiting player shows its poster and asks for nothing else', r.inStage && r.loaded && r.h === r.vh && frames.length === 0, `${JSON.stringify(r)}, other requests ${frames.length}`);
});

// Stills: the poster stays until the stills are in.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/tour/manifest.json', async (route) => {
    await held;
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/static.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__player?.hasAttribute('stills'), null, { timeout: 15000 });
  const before = await posterState(page);
  release();
  const ok = await ready(page);
  const after = await page.evaluate(() => ({ poster: !!document.querySelector('[data-poster]'), stills: document.querySelectorAll('.ft__still img').length, first: document.querySelector('.ft__still img')?.getAttribute('src') }));
  check('stills: the poster shows until the stills are in, then the first still takes over', before.there && before.fills && before.cards === 'hidden,hidden,hidden,hidden' && ok && !after.poster && after.stills === 4 && after.first.endsWith('/0049.webp') && errors.length === 0, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
});

// Nothing to show: the poster goes with the player.
for (const mode of ['scrub', 'stills']) {
  await session({ ...COMPUTER, reducedMotion: mode === 'stills' ? 'reduce' : 'no-preference' }, async (page) => {
    await page.route((u) => u.pathname === '/nope/manifest.json', (route) => route.fulfill({ status: 404, body: 'gone' }));
    await page.goto(`${base}/static.html?src=/nope/manifest.json`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__player?.hasAttribute('error'), null, { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(() => ({ err: window.__player.hasAttribute('error'), h: window.__player.offsetHeight }));
    check(`no manifest (${mode}): the player takes no room, poster included`, r.err && r.h === 0, JSON.stringify(r));
  });
}

// ---- AVIF frames
await session(COMPUTER, async (page, { errors }) => {
  if (avifMade) return check('AVIF frames: made by the frame maker', false, avifMade);
  await page.goto(`${base}/?above=0&src=/avif/manifest.json`, { waitUntil: 'load' });
  const can = await page.evaluate(() => new Promise((done) => {
    const img = new Image();
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = '/avif/small/0001.avif';
  }));
  // Playwright's WebKit build for Windows has no AVIF decoder; Safari has.
  if (!can) return check('AVIF frames: this browser build cannot decode AVIF, not checked here', true, 'skipped');
  const ok = await ready(page);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    window.scrollTo(0, p.yFor(0.5));
    await new Promise((r) => setTimeout(r, 600));
    const c = p.querySelector('canvas');
    const px = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return { frames: p.manifest.frames, frame: p.frame, drawn: p.drawn, lit: px[0] + px[1] + px[2], url: p.set.pattern };
  });
  check('AVIF frames play: loaded, drawn, the picture follows the scroll', ok && r.frames === 48 && r.url.endsWith('.avif') && r.drawn > 5 && r.lit > 0 && errors.length === 0, JSON.stringify(r));
});

// ---- stops and moments by frame number or by seconds
// Where each way of writing the stops put them; the checks further down
// compare against the 0 to 1 way.
const placed = {};
{
  for (const by of ['at', 'frame', 'time']) {
    await session(COMPUTER, async (page, { errors }) => {
      await page.goto(`${base}/?above=0&moment=1&by=${by}`, { waitUntil: 'load' });
      const ok = await ready(page);
      placed[by] = await page.evaluate(async () => {
        const p = window.__player;
        const written = JSON.parse(p.getAttribute('stops'));
        const mo = p.querySelector('[data-moment]');
        // Rest on the second stop, then pass through the moment.
        window.scrollTo(0, p.yFor(p.stopScroll[1]));
        await new Promise((r) => setTimeout(r, 400));
        const card = document.querySelector('[data-stop][data-active]')?.dataset.stop;
        const frame = p.frame;
        window.scrollTo(0, p.yFor(p.stopScroll[1] + (p.stopScroll[2] - p.stopScroll[1]) * 0.3));
        await new Promise((r) => setTimeout(r, 400));
        return {
          keys: Object.keys(written[4]).sort().join(','),
          momentAttrs: Object.keys(mo.dataset).sort().join(','),
          at: p.stopList.map((s) => s.at),
          from: p.stopList[4].from,
          scroll: p.stopScroll,
          moment: [p.moments[0].from, p.moments[0].to],
          labels: p.querySelectorAll('.ft__label').length,
          card,
          frame,
          momentOn: mo.hasAttribute('data-active'),
        };
      });
      check(`stops by ${by}: the player starts, five labels, no errors`, ok && placed[by].labels === 5 && errors.length === 0, `${placed[by].keys}; moment ${placed[by].momentAttrs}`);
    });
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-4);
  for (const by of ['frame', 'time']) {
    const a = placed.at;
    const b = placed[by];
    check(`stops by ${by}: written with "${by}", not "at"`, b.keys.split(',').includes(by) && !b.keys.split(',').includes('at') && b.momentAttrs.toLowerCase().includes(`from${by}`), `${b.keys}; ${b.momentAttrs}`);
    check(`stops by ${by}: every stop sits where it does by share`, same(a.at, b.at) && same(a.scroll, b.scroll) && Math.abs(a.from - b.from) < 2e-4, b.at.map((v) => v.toFixed(4)).join(' '));
    check(`stops by ${by}: the second stop's card on frame 121, the moment in its stretch`, b.card === 'lobby' && b.frame === 120 && b.momentOn && same(a.moment, b.moment), `card ${b.card}, frame ${b.frame + 1}, moment ${b.moment.map((v) => v.toFixed(4)).join(' to ')}`);
  }
}

// A stop with no place is left out, and said; the others play.
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => {
    const el = document.createElement('fly-through');
    el.setAttribute('src', '/tour/manifest.json');
    el.setAttribute('stops', '[{"id":"late","frame":600},{"id":"lost"},{"id":"early","time":2}]');
    el.innerHTML = '<div data-stop="early">Early</div><div data-stop="late">Late</div>';
    window.__player.replaceWith(el);
    window.__mixed = el;
  });
  const ok = await ready(page, 'window.__mixed');
  const r = await page.evaluate(() => ({ ids: window.__mixed.stopList.map((s) => s.id).join(','), at: window.__mixed.stopList.map((s) => s.at.toFixed(4)).join(','), labels: [...window.__mixed.querySelectorAll('.ft__label')].map((b) => b.textContent).join(',') }));
  check('a stop with no place is left out with a warning; frame and time mix, in flight order', ok && r.ids === 'early,late' && r.labels === 'early,late' && r.at === `${(48 / 719).toFixed(4)},${(599 / 719).toFixed(4)}` && warnings.some((w) => w.includes('stop "lost" has no place')), `${r.ids} at ${r.at}; ${warnings.find((w) => w.includes('no place')) ?? 'no warning'}`);
});

// Stills take the same places.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&moment=1&by=frame`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => ({
    order: [...document.querySelector('.ft__stills').children].map((e) => e.dataset.still || (e.classList.contains('ft__still--moment') ? 'moment' : '?')).join(','),
    stills: [...document.querySelectorAll('.ft__still img')].map((i) => i.getAttribute('src').split('/').pop()).join(','),
  }));
  check('stills, stops by frame: each stop on its own frame, the moment between', r.order === 'entrance,lobby,moment,room,terrace,overview' && r.stills === '0049.webp,0121.webp,0201.webp,0313.webp,0493.webp,0720.webp' && errors.length === 0, `${r.order}; ${r.stills}`);
});

// ---- the debug overlay (flythrough/debug)
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&moment=1&by=frame&debug=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  const at = async (sp) =>
    page.evaluate(async (sp) => {
      const p = window.__player;
      if (sp !== null) {
        window.scrollTo(0, p.yFor(sp === 'stop2' ? p.stopScroll[1] : sp));
        await new Promise((r) => setTimeout(r, 400));
      }
      const box = p.querySelector('.ft__debug');
      const strip = box?.querySelector('.ft__debug-track');
      const band = strip?.querySelector('[data-debug-stop="lobby"]');
      const h = strip?.getBoundingClientRect().height ?? 1;
      return {
        there: !!box,
        inStage: !!box?.closest('.ft__stage'),
        read: box?.querySelector('.ft__debug-read')?.textContent ?? '',
        stops: strip?.querySelectorAll('[data-debug-stop]').length ?? 0,
        moments: strip?.querySelectorAll('[data-debug-moment]').length ?? 0,
        mark: strip ? (strip.querySelector('.ft__debug-mark').getBoundingClientRect().top + 1 - strip.getBoundingClientRect().top) / h : -1,
        band: band ? [(band.getBoundingClientRect().top - strip.getBoundingClientRect().top) / h, (band.getBoundingClientRect().bottom - strip.getBoundingClientRect().top) / h] : [],
        // What the band should span: the stop's reach either side, in the track.
        want: [p.stopScroll[1] - p.reachOf.reach, p.stopScroll[1] + p.reachOf.reach],
        labels: [...(strip?.children ?? [])].map((c) => c.textContent).filter(Boolean),
        pos: p.scrollPos,
        frame: p.frame,
        hits: document.elementFromPoint(40, 40)?.closest('.ft__debug') ? 'debug' : 'page',
      };
    }, sp);
  const first = await at(null);
  check('debug: the overlay is in the stage, with a band per stop and per moment', first.there && first.inStage && first.stops === 5 && first.moments === 1, JSON.stringify({ stops: first.stops, moments: first.moments }));
  const two = await at('stop2');
  check('debug: on the second stop it reads frame 121 of 720, the stop showing', two.read.includes('frame 121 of 720') && two.read.includes('stop lobby') && two.read.includes(`track ${two.pos.toFixed(4)}`), two.read.replace(/\n/g, ' | '));
  check("debug: a stop's band spans its reach, its label gives the frames", Math.abs(two.band[0] - two.want[0]) < 0.004 && Math.abs(two.band[1] - two.want[1]) < 0.004 && two.labels.some((l) => /^lobby {2}frame 121 {2}reach \d+ to \d+$/.test(l)), `band ${two.band.map((v) => v.toFixed(3))}, reach ${two.want.map((v) => v.toFixed(3))}; ${two.labels[1]}`);
  const mid = await at(0.6);
  check('debug: the marker follows the scroll along the track', Math.abs(two.mark - two.pos) < 0.004 && Math.abs(mid.mark - 0.6) < 0.004 && mid.frame !== two.frame, `marker ${two.mark.toFixed(3)} then ${mid.mark.toFixed(3)}`);
  check('debug: it never takes a click from the page', mid.hits === 'page', mid.hits);
  const gone = await page.evaluate(async () => {
    window.__undebug();
    window.scrollTo(0, window.__player.yFor(0.3));
    await new Promise((r) => setTimeout(r, 300));
    return !document.querySelector('.ft__debug');
  });
  check('debug: its return value removes it', gone && errors.length === 0, errors.join(' | '));
});

// debug() with no player takes every one on the page; stills have no track.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&debug=1`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => !document.querySelector('.ft__debug'));
  check('debug: nothing in stills, and no error', r && errors.length === 0, errors.join(' | '));
});

// ---- --ft-progress: how far the flight is, for a host's own CSS
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&progress=1`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    // The host page marked a box in the first card (data-progress); a dot
    // in it is moved by the flight in CSS alone.
    const box = p.querySelector('[data-progress]');
    const dot = box.firstElementChild;
    const read = () => ({
      own: Number(getComputedStyle(box).getPropertyValue('--ft-progress')),
      card: Number(getComputedStyle(dot).getPropertyValue('--ft-progress')),
      player: getComputedStyle(p).getPropertyValue('--ft-progress'),
      x: new DOMMatrix(getComputedStyle(dot).transform).m41,
      progress: p.progress,
    });
    const out = [];
    for (const sp of [p.stopScroll[1], 0.6, 1, 0]) {
      window.scrollTo(0, p.yFor(sp));
      await new Promise((r) => setTimeout(r, 300));
      out.push(read());
    }
    return out;
  });
  const right = r.every((s) => Math.abs(s.own - s.progress) <= 0.00006 && s.card === s.own && Math.abs(s.x - s.own * 1000) < 0.01);
  check('--ft-progress follows the flight, 0 to 1, on a marked element and inside it', right && r[2].own === 1 && r[3].own === 0 && r[1].own > r[0].own && errors.length === 0, r.map((s) => `${s.own} (flight ${s.progress.toFixed(5)}, moved ${s.x.toFixed(1)} px)`).join('; '));
  check('--ft-progress is never written on the player itself', r.every((s) => s.player === ''), JSON.stringify(r.map((s) => s.player)));
});
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page) => {
  await page.goto(`${base}/?above=0&progress=1`, { waitUntil: 'load' });
  await ready(page);
  const v = await page.evaluate(() => getComputedStyle(window.__player.querySelector('[data-progress]')).getPropertyValue('--ft-progress'));
  check('--ft-progress is not set in stills', v === '', `"${v}"`);
});

// ---- stops written on their cards (no stops attribute), legs as a plain list
for (const by of ['at', 'frame']) {
  await session(COMPUTER, async (page, { errors, warnings }) => {
    await page.goto(`${base}/?above=0&cards=1&legs=plain&moment=1&by=${by}`, { waitUntil: 'load' });
    const ok = await ready(page);
    const r = await page.evaluate(async () => {
      const p = window.__player;
      window.scrollTo(0, p.yFor(p.stopScroll[1]));
      await new Promise((r) => setTimeout(r, 400));
      const card = p.querySelector('[data-stop="lobby"]');
      return {
        attr: p.getAttribute('stops'),
        written: Object.keys(card.dataset).filter((k) => k !== 'active').sort().join(','),
        legs: p.getAttribute('legs'),
        at: p.stopList.map((s) => s.at),
        scroll: p.stopScroll,
        from: p.stopList[4].from,
        labels: [...p.querySelectorAll('.ft__label')].map((b) => b.textContent).join(','),
        focus: p.stopList[1].focus,
        card: document.querySelector('[data-stop][data-active]')?.dataset.stop,
        frame: p.frame,
      };
    });
    const json = placed.at;
    const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-4);
    check(`stops on their cards (by ${by}): no stops attribute, five stops with their labels`, ok && r.attr === null && r.labels === 'Entrance,Lobby,Room,Terrace,Overview' && errors.length === 0 && warnings.length === 0, `${r.written}; ${r.labels}; ${warnings.join(' | ')}`);
    check(`stops on their cards (by ${by}): the same places, focus and early showing as the JSON`, same(r.at, json.at) && same(r.scroll, json.scroll) && Math.abs(r.from - json.from) < 2e-4 && r.focus?.join() === '0.6,0.55' && r.card === 'lobby' && r.frame === 120, `${r.at.map((v) => v.toFixed(4)).join(' ')}; legs "${r.legs}"`);
  });
}

// ---- small things from the syntax review
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const vh = innerHeight;
    const cardAt = async (y) => {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
      return document.querySelector('[data-stop][data-active]')?.dataset.stop ?? null;
    };
    const stop2 = p.yFor(p.stopScroll[1]);
    const inside = await cardAt(stop2 + 0.3 * vh);
    const outside = await cardAt(stop2 + 0.46 * vh);
    p.goToStop('nowhere');
    p.goToStop('room');
    await new Promise((r) => setTimeout(r, 3300));
    return { reach: p.reachOf.reach, want: 0.38 / 6.75, inside, outside, y: Math.round(scrollY), room: Math.round(p.yFor(p.stopScroll[2])) };
  });
  check('reach is in screen heights: 0.38 of a screen either side of a stop', Math.abs(r.reach - r.want) < 1e-9 && r.inside === 'lobby' && r.outside === null, `share ${r.reach.toFixed(5)}; at 0.30 screens ${r.inside}, at 0.46 ${r.outside}`);
  check("goToStop takes a stop's id; an id that is not there does nothing", Math.abs(r.y - r.room) <= 2 && errors.length === 0, `y ${r.y}, stop 3 at ${r.room}`);
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&bar=off&intro=false`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ bar: !!document.querySelector('.ft__bar'), y: Math.round(scrollY), first: Math.round(window.__player.yFor(window.__player.stopScroll[0])), back: window.__player.returnFirst, attr: window.__player.getAttribute('intro') }));
  check('bar="off": no stop bar', !r.bar);
  check('intro="false" is off: opens on the first stop at once, no return to it', r.attr === 'false' && Math.abs(r.y - r.first) <= 2 && r.back === false, `y ${r.y}, first stop ${r.first}, return-to-first ${r.back}`);
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  const n = await page.evaluate(async () => {
    const el = document.createElement('fly-through');
    el.setAttribute('src', '/tour/manifest.json');
    el.setAttribute('stops', '[{"id":"a","at":0.5},]');
    window.__player.replaceWith(el);
    await new Promise((r) => setTimeout(r, 1500));
    return el.stopList.length;
  });
  check('stops that are not valid JSON: said in the console, a plain scrub is left', n === 0 && warnings.some((w) => w.includes('stops is not valid JSON')), warnings.find((w) => w.includes('JSON')) ?? 'no message');
});

// ---- live settings: an attribute changed while the player runs takes effect
const liveState = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    return {
      y: Math.round(scrollY),
      frame: p.frame,
      track: p.querySelector('.ft__track').offsetHeight,
      vh: p.lvh(),
      stops: p.stopScroll.map((s) => Math.round(p.yFor(s))),
      labels: [...p.querySelectorAll('.ft__label')].map((b) => b.textContent).join(','),
      card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? null,
      barLabel: p.querySelector('.ft__bar')?.getAttribute('aria-label') ?? null,
    };
  });
const setAttr = async (page, name, value, wait = 300) => {
  await page.evaluate(([name, value]) => (value === null ? window.__player.removeAttribute(name) : window.__player.setAttribute(name, value)), [name, value]);
  await page.waitForTimeout(wait);
};
for (const lenis of [0, 1]) {
  const tag = lenis ? 'live, with Lenis' : 'live';
  await session(COMPUTER, async (page, { errors, warnings }) => {
    await page.addInitScript(() => {
      window.__stopEvents = 0;
      document.addEventListener('flythrough-stop', () => window.__stopEvents++);
    });
    await page.goto(`${base}/?above=0&lenis=${lenis}`, { waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(400);
    const place = async (y) => {
      await page.evaluate((y) => (window.__lenis ? window.__lenis.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y)), y);
      await page.waitForTimeout(300);
    };
    let s = await liveState(page);
    await place(s.stops[2]);
    const before = await liveState(page);

    // Pacing: new legs lay the track out again; the visitor keeps the frame.
    await setAttr(page, 'legs', '1 1 1 1 1');
    let after = await liveState(page);
    check(`${tag}: new legs lay the track out again and keep the place in the flight`, after.track === 6 * after.vh && before.track !== after.track && Math.abs(after.frame - before.frame) <= 1 && after.card === 'room' && Math.abs(after.y - after.stops[2]) <= 2, `track ${before.track} -> ${after.track}, frame ${before.frame} -> ${after.frame}, y ${before.y} -> ${after.y}`);
    await setAttr(page, 'hold', '1');
    after = await liveState(page);
    check(`${tag}: a hold added later lengthens the track by a screen`, after.track === 7 * after.vh && after.card === 'room', `track ${after.track}`);
    await setAttr(page, 'hold', null);

    // Stops: one moved and renamed.
    const moved = await page.evaluate(async () => {
      const p = window.__player;
      const stops = JSON.parse(p.getAttribute('stops'));
      const lobby = stops[1];
      for (const k of ['at', 'frame', 'time']) delete lobby[k];
      lobby.frame = 200;
      lobby.label = 'Hall';
      p.setAttribute('stops', JSON.stringify(stops));
      await new Promise((r) => setTimeout(r, 300));
      window.__lenis ? window.__lenis.scrollTo(p.yFor(p.stopScroll[1]), { immediate: true, force: true }) : window.scrollTo(0, p.yFor(p.stopScroll[1]));
      await new Promise((r) => setTimeout(r, 400));
      return { frame: p.frame, card: document.querySelector('[data-stop][data-active]')?.dataset.stop, labels: [...p.querySelectorAll('.ft__label')].map((b) => b.textContent).join(','), current: p.querySelector('.ft__label[aria-current]')?.textContent };
    });
    check(`${tag}: a stop moved and renamed in the stops attribute moves on the bar and in the flight`, moved.frame === 199 && moved.card === 'lobby' && moved.labels === 'Entrance,Hall,Room,Terrace,Overview' && moved.current === 'Hall', JSON.stringify(moved));

    // The rest rule: snap off, then on again.
    const restNear = async () => {
      const st = await liveState(page);
      await place(st.stops[2] + Math.round(st.vh * 0.2));
      await page.mouse.move(400, 400);
      await page.mouse.wheel(0, 30);
      await page.waitForTimeout(2600);
      const end = await liveState(page);
      return Math.abs(end.y - end.stops[2]) <= 2;
    };
    await setAttr(page, 'snap', 'off');
    const stays = !(await restNear());
    await setAttr(page, 'snap', null);
    const glides = await restNear();
    check(`${tag}: snap="off" set later stops the pull to a stop, taken away it pulls again`, stays && glides, `off: stays ${stays}; on: glides ${glides}`);

    // reach, bar, bar-label, fit, loading-text.
    await setAttr(page, 'reach', '0.05');
    s = await liveState(page);
    await place(s.stops[2] + Math.round(s.vh * 0.2));
    const narrow = (await liveState(page)).card;
    await setAttr(page, 'reach', '0.38');
    const wide = (await liveState(page)).card;
    check(`${tag}: reach changed later narrows and widens a card's reach where the page stands`, narrow === null && wide === 'room', `0.05: ${narrow}; 0.38: ${wide}`);
    await setAttr(page, 'bar', 'off');
    const noBar = (await liveState(page)).labels;
    await setAttr(page, 'bar', null);
    await setAttr(page, 'bar-label', 'Rooms');
    const bar = await liveState(page);
    check(`${tag}: bar="off" and bar-label set later take the bar away, bring it back and rename it`, noBar === '' && bar.labels === 'Entrance,Hall,Room,Terrace,Overview' && bar.barLabel === 'Rooms', `off: "${noBar}"; back: ${bar.labels}, "${bar.barLabel}"`);
    const events = await page.evaluate(() => window.__stopEvents);
    const edge = async () =>
      page.evaluate(() => {
        const c = window.__player.querySelector('canvas');
        const d = c.getContext('2d').getImageData(c.width >> 1, 2, 1, 1).data;
        return d[0] + d[1] + d[2];
      });
    const cover = await edge();
    await setAttr(page, 'fit', 'contain');
    const contain = await edge();
    await setAttr(page, 'fit', null);
    const again = await edge();
    check(`${tag}: fit="contain" set later shows the whole frame (bars above and below), and back`, cover > 0 && contain === 0 && again > 0, `top edge ${cover} -> ${contain} -> ${again}`);
    check(`${tag}: a change that moves no stop sends no stop event`, (await page.evaluate(() => window.__stopEvents)) === events, `${events} before and after`);

    // What is read at the start only says so.
    const quiet = warnings.length;
    await setAttr(page, 'src', '/other/manifest.json');
    await setAttr(page, 'mode', 'stills');
    const said = warnings.slice(quiet).filter((w) => w.includes('is read when the player starts'));
    check(`${tag}: src and mode changed later change nothing, and the console says why`, said.length === 2 && !(await page.evaluate(() => window.__player.hasAttribute('stills'))) && errors.length === 0, said[0] ?? 'no message');
  });
}

// Cards are settings too: one changed, one added.
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&cards=1&nolegs=1&by=frame`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const wait = () => new Promise((r) => setTimeout(r, 300));
    p.querySelector('[data-stop="lobby"]').dataset.frame = '260';
    p.querySelector('[data-stop="lobby"]').dataset.label = 'Hall';
    await wait();
    const moved = { at: p.stopList[1].at, label: p.querySelectorAll('.ft__label')[1].textContent };
    const extra = document.createElement('div');
    extra.dataset.stop = 'extra';
    extra.dataset.frame = '400';
    extra.dataset.label = 'Extra';
    extra.textContent = 'An extra card';
    p.append(extra);
    await wait();
    window.scrollTo(0, p.yFor(p.stopScroll[3]));
    await wait();
    return { moved, ids: p.stopList.map((s) => s.id).join(','), labels: p.querySelectorAll('.ft__label').length, inStage: !!extra.closest('.ft__overlays'), card: document.querySelector('[data-stop][data-active]')?.dataset.stop, frame: p.frame };
  });
  check('live: a place and a label changed on a card move and rename its stop', Math.abs(r.moved.at - 259 / 719) < 1e-6 && r.moved.label === 'Hall', JSON.stringify(r.moved));
  check('live: a card added to the element becomes a stop, in flight order', r.ids === 'entrance,lobby,room,extra,terrace,overview' && r.labels === 6 && r.inStage && r.card === 'extra' && r.frame === 399 && errors.length === 0, JSON.stringify(r));
});

// Stills are as they were built; before the start a change is simply read.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  await setAttr(page, 'legs', '1 1 1 1 1');
  check('live: in stills a setting changed later has no effect, and the console says so', warnings.some((w) => w.includes('showing stills')), warnings.find((w) => w.includes('stills')) ?? 'no message');
});
await session(COMPUTER, async (page, { asked }) => {
  await page.goto(`${base}/?aboveh=400`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await setAttr(page, 'legs', '1 1 1 1 1');
  await setAttr(page, 'bar-label', 'Rooms');
  const waited = asked.length === 0;
  await scrollTo(page, 1.2);
  const ok = await ready(page);
  const s = await liveState(page);
  check('live: settings changed while a player waits far down are the ones it starts with', waited && ok && s.track === 6 * s.vh && s.barLabel === 'Rooms', `track ${s.track}, bar "${s.barLabel}"`);
});

// ---- a player in a box (--ft-stage-height)
const boxState = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    const stage = p.querySelector('.ft__stage').getBoundingClientRect();
    const canvas = p.querySelector('canvas');
    const bar = p.querySelector('.ft__bar')?.getBoundingClientRect();
    return {
      boxed: p.hasAttribute('boxed'),
      y: Math.round(scrollY),
      vh: innerHeight,
      stage: { top: Math.round(stage.top), left: Math.round(stage.left), w: Math.round(stage.width), h: Math.round(stage.height) },
      track: p.querySelector('.ft__track').offsetHeight,
      canvas: [canvas.width, canvas.height],
      barInside: !!bar && bar.left >= stage.left && bar.right <= stage.right && bar.bottom <= stage.bottom,
      pos: p.scrollPos,
      frame: p.frame,
      card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? null,
      start: Math.round(p.yFor(0)),
      end: Math.round(p.yFor(1)),
      stops: p.stopScroll.map((s) => Math.round(p.yFor(s))),
      set: p.set.pattern.split('/')[0],
      max: document.documentElement.scrollHeight - innerHeight,
    };
  });
for (const lenis of [0, 1]) {
  const tag = lenis ? 'box, with Lenis' : 'box';
  await session(COMPUTER, async (page, { errors }) => {
    const place = async (y) => {
      await page.evaluate((y) => (window.__lenis ? window.__lenis.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y)), y);
      await page.waitForTimeout(350);
    };
    await page.goto(`${base}/?stage=60&stagew=900&lenis=${lenis}`, { waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(400);
    const top = await boxState(page);
    // The content above is 1.5 screens: the box pins when its top is 0.2 of
    // a screen from the top, which is where the flight starts.
    check(`${tag}: the stage is the box (900 wide, 0.6 of the screen), the track its legs and the box`, top.boxed && top.stage.w === 900 && top.stage.h === 540 && top.track === 6.75 * 900 + 540 && top.canvas[0] === 900 && top.canvas[1] === 540 && top.y === 0, JSON.stringify({ stage: top.stage, track: top.track, canvas: top.canvas }));
    check(`${tag}: the flight runs from where the box pins to where it lets go`, top.start === 1350 - 180 && top.end === top.start + 6.75 * 900, `${top.start} to ${top.end}`);
    await place(top.start);
    const first = await boxState(page);
    await place(top.end);
    const last = await boxState(page);
    await place(Math.round((top.start + top.end) / 2));
    const mid = await boxState(page);
    check(`${tag}: the box stays in the middle of the screen from the first frame to the last`, [first, mid, last].every((s) => Math.abs(s.stage.top - 180) <= 1 && s.stage.left === 270) && first.frame === 0 && last.frame === 719 && first.pos === 0 && last.pos === 1, `top ${first.stage.top}, ${mid.stage.top}, ${last.stage.top}; frames ${first.frame}, ${mid.frame}, ${last.frame}`);
    await place(top.stops[2]);
    const third = await boxState(page);
    check(`${tag}: a stop shows its card on its frame, the bar inside the box`, third.card === 'room' && third.frame === 312 && third.barInside, `card ${third.card}, frame ${third.frame + 1}`);
    // The rest rule, in the track and outside it.
    const rest = async (y) => {
      await place(y);
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, 30);
      await page.waitForTimeout(2700);
      return (await boxState(page)).y;
    };
    const pulled = await rest(top.stops[1] + 180);
    const between = Math.round((top.stops[1] + top.stops[2]) / 2);
    const left = await rest(between);
    const above = await rest(400);
    check(`${tag}: coming to rest pulls to the stop whose card shows, and nowhere else`, Math.abs(pulled - top.stops[1]) <= 2 && Math.abs(left - between) <= 60 && Math.abs(above - 400) <= 60, `near stop 2: ${pulled} (stop at ${top.stops[1]}); between: ${left}; above the player: ${above}`);
    check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
  });
}

// A box at the very top of the page is pinned from the start: the flight
// begins at the top, the intro plays, the last stop is reachable.
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&stage=60&stagew=900&intro=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(3600);
  const s = await boxState(page);
  check('box at the top of the page: the flight starts at the top, the intro lands on the first stop', s.start === 0 && Math.abs(s.y - s.stops[0]) <= 2 && s.card === 'entrance' && Math.abs(s.stage.top - 180) <= 1, `start ${s.start}, y ${s.y}, first stop ${s.stops[0]}`);
  await page.evaluate((y) => window.scrollTo(0, y), s.end);
  await page.waitForTimeout(400);
  const e = await boxState(page);
  check('box at the top of the page: the last frame comes as the box lets go', e.frame === 719 && e.end <= e.max && Math.abs(e.stage.top - 180) <= 1, `frame ${e.frame + 1}, box top ${e.stage.top}`);
});

// The frame set follows the box's shape and size, not the window's.
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&stage=80&stagew=320`, { waitUntil: 'load' });
  await ready(page);
  const tall = await boxState(page);
  check('an upright box on a wide screen plays the upright frame set', tall.set === 'portrait' && tall.stage.w === 320 && tall.stage.h === 720, `${tall.set}, ${tall.stage.w}x${tall.stage.h}`);
});
await session({ viewport: { width: 390, height: 780 } }, async (page) => {
  await page.goto(`${base}/?above=0&stage=30`, { waitUntil: 'load' });
  await ready(page);
  const wide = await boxState(page);
  check('a wide box on an upright phone plays the wide frame set', wide.set === 'landscape' && wide.stage.w === 390 && wide.stage.h === 234, `${wide.set}, ${wide.stage.w}x${wide.stage.h}`);
});

// A phone's address bar: the box and the track hold still (the large
// viewport pinned as in test/review-test.mjs; a box sized in px, since a
// test window's vh follows its height where a phone's does not).
await session({ viewport: { width: 390, height: 664 }, hasTouch: true }, async (page) => {
  await page.goto(`${base}/?above=0&stagepx=300`, { waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, window.__player.yFor(window.__player.stopScroll[2])));
  await page.waitForTimeout(500);
  const a = await boxState(page);
  await page.addStyleTag({ content: '.ft__probe { height: 664px !important; }' });
  await page.setViewportSize({ width: 390, height: 664 + 60 });
  await page.waitForTimeout(600);
  const b = await boxState(page);
  check('box on a phone: the address bar hiding leaves the track and the box as they were', a.track === b.track && b.stage.h === 300 && b.card === 'room' && a.track === 6.75 * 664 + 300, `track ${a.track} -> ${b.track}, card ${b.card}`);
});

// Stills in a box: each still is the box's height.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&stage=60&stagew=900`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('.ft__still')].map((s) => `${Math.round(s.getBoundingClientRect().width)}x${Math.round(s.getBoundingClientRect().height)}`).join(','));
  check('stills in a box: each still is the box', r === Array(5).fill('900x540').join(',') && errors.length === 0, r);
});

// A box at the top of the page holds the page while it loads, as the
// full-screen player does (it is pinned from the start); out of the track
// (the scrollbar, a script) the page scrolls.
await session(COMPUTER, async (page) => {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await held;
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0&stage=60&stagew=900`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__player?.booted, null, { timeout: 15000 });
  const first = await page.evaluate(() => Math.round(scrollY));
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const top = await page.evaluate(() => ({ y: Math.round(scrollY), holds: window.__player.holdsPage }));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const end = await page.evaluate(() => Math.round(scrollY));
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const below = await page.evaluate(() => Math.round(scrollY));
  release();
  check('box at the top of the page, loading: the page is held while the box is pinned, not below it', top.holds && top.y === first && below === end - 300, `on the first stop: ${first} -> ${top.y}; below the track: ${end} -> ${below}`);
});

// A box further down the page never holds the page (as a full-screen
// player there does not): the visitor scrolls to it and through it.
await session(COMPUTER, async (page) => {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await held;
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?stage=60&stagew=900`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__player?.booted, null, { timeout: 15000 });
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const free = await page.evaluate(() => Math.round(scrollY));
  await page.evaluate(() => window.scrollTo(0, window.__player.yFor(0.3)));
  await page.waitForTimeout(300);
  const at = await page.evaluate(() => Math.round(scrollY));
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const pinned = await page.evaluate(() => Math.round(scrollY));
  const veil = await page.evaluate(() => {
    const l = document.querySelector('.ft__loading').getBoundingClientRect();
    const s = document.querySelector('.ft__stage').getBoundingClientRect();
    return Math.round(l.width) === Math.round(s.width) && Math.round(l.height) === Math.round(s.height);
  });
  release();
  check('box further down, loading: the page scrolls above the box and through it', free === 300 && pinned === at + 300 && veil, `above: moved to ${free}; pinned: ${at} -> ${pinned}; loading screen fills the box ${veil}`);
});

// A box that goes away (a media query dropping --ft-stage-height) leaves a
// full-screen player, and comes back.
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&stage=60&stagew=900`, { waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, window.__player.yFor(window.__player.stopScroll[2])));
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const wait = () => new Promise((r) => setTimeout(r, 500));
    const read = () => ({ boxed: p.hasAttribute('boxed'), h: Math.round(p.querySelector('.ft__stage').getBoundingClientRect().height), track: p.querySelector('.ft__track').offsetHeight, frame: p.frame, card: document.querySelector('[data-stop][data-active]')?.dataset.stop });
    window.__read = read;
    p.style.removeProperty('--ft-stage-height');
    p.style.maxWidth = 'none';
    await wait();
    const full = read();
    p.style.setProperty('--ft-stage-height', '50vh');
    return { full };
  });
  // As a media query would bring it back: with the window changing size.
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.waitForTimeout(600);
  r.box = await page.evaluate(() => window.__read());
  check('a box that goes away leaves the full-screen player at the same place, and comes back', !r.full.boxed && r.full.h === 900 && r.full.track === 7.75 * 900 && r.full.card === 'room' && r.box.boxed && r.box.h === 450 && r.box.track === 6.75 * 900 + 450 && r.box.card === 'room' && errors.length === 0, `${JSON.stringify(r)}${errors.length ? `; errors: ${errors.join(' | ')}` : ''}`);
});

// ---- the entry without GSAP (flythrough/no-gsap; gsap=0 on the host page)
const gsapLoaded = (page) => page.evaluate(() => performance.getEntriesByType('resource').some((r) => /\/deps\/gsap|node_modules\/gsap/i.test(r.name)));
// Chromium's own note about this test reading the canvas back.
const real = (warnings) => warnings.filter((w) => !w.includes('willReadFrequently'));

// A plain scrub needs nothing: no GSAP, no Lenis.
await session(COMPUTER, async (page, { errors, warnings }) => {
  await page.goto(`${base}/?above=0&gsap=0&lenis=0&plain=1`, { waitUntil: 'load' });
  const ok = await ready(page);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const out = [];
    for (const sp of [0.5, 1, 0.25]) {
      window.scrollTo(0, p.yFor(sp));
      await new Promise((r) => setTimeout(r, 300));
      const c = p.querySelector('canvas');
      const px = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      out.push({ pos: p.position, frame: p.frame, drawn: p.drawn, lit: px[0] + px[1] + px[2] });
    }
    return { out, lenis: !!window.__lenis, noGsap: window.__noGsap, bar: !!p.querySelector('.ft__bar') };
  });
  const follows = Math.abs(r.out[0].frame - 360) <= 1 && r.out[1].frame === 719 && Math.abs(r.out[2].frame - 180) <= 1 && r.out.every((s) => s.drawn === s.frame && s.lit > 0);
  check('no GSAP, a plain scrub: the picture follows the scroll with no GSAP and no Lenis on the page', ok && r.noGsap && !r.lenis && !(await gsapLoaded(page)) && follows && !r.bar && errors.length === 0 && real(warnings).length === 0, `frames ${r.out.map((s) => s.frame + 1).join(', ')}; ${real(warnings).join(' | ')}`);
});

// Stops and no Lenis: cards and labels work, nothing glides, and it says so once.
await session(COMPUTER, async (page, { errors, warnings }) => {
  await page.goto(`${base}/?above=0&gsap=0&lenis=0&intro=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const stops = p.stopScroll.map((s) => Math.round(p.yFor(s)));
    const opened = Math.round(scrollY);
    window.scrollTo(0, stops[1]);
    await new Promise((r) => setTimeout(r, 300));
    const card = document.querySelector('[data-stop][data-active]')?.dataset.stop;
    document.querySelectorAll('.ft__label')[3].click();
    await new Promise((r) => setTimeout(r, 200));
    const tapped = Math.round(scrollY);
    p.goToStop('room');
    await new Promise((r) => setTimeout(r, 200));
    return { stops, opened, card, tapped, went: Math.round(scrollY), frame: p.frame };
  });
  check('no GSAP, no Lenis: intro opens on the first stop; cards show; a label tap and goToStop jump there', Math.abs(r.opened - r.stops[0]) <= 2 && r.card === 'lobby' && Math.abs(r.tapped - r.stops[3]) <= 2 && Math.abs(r.went - r.stops[2]) <= 2 && r.frame === 312, JSON.stringify(r));
  // Rest a little off stop 2, its card showing: the page stays.
  await page.evaluate((y) => window.scrollTo(0, y), r.stops[1] + 150);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 30);
  await page.waitForTimeout(2600);
  const y = await page.evaluate(() => Math.round(scrollY));
  const said = warnings.filter((w) => w.includes('need Lenis'));
  check('no GSAP, no Lenis: the page does not come to rest, and the console says once what is missing', Math.abs(y - (r.stops[1] + 180)) <= 5 && said.length === 1 && !(await gsapLoaded(page)) && errors.length === 0, `rests at ${y}, stop 2 at ${r.stops[1]}; ${said.length} message(s)`);
});

// With Lenis it glides as the default entry does (the host suite runs whole
// on this entry too: host-test, review-test and input-test with --no-gsap).
await session(COMPUTER, async (page, { errors, warnings }) => {
  await page.goto(`${base}/?above=0&gsap=0&intro=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(700);
  const early = await page.evaluate(() => ({ y: Math.round(scrollY), first: Math.round(window.__player.yFor(window.__player.stopScroll[0])) }));
  await page.waitForTimeout(3200);
  const s = await page.evaluate(() => {
    const p = window.__player;
    return { y: Math.round(scrollY), stops: p.stopScroll.map((x) => Math.round(p.yFor(x))), lenis: !!window.__lenis, card: document.querySelector('[data-stop][data-active]')?.dataset.stop };
  });
  check('no GSAP, with Lenis: the intro glides from the first frame to the first stop', s.lenis && early.y > 0 && early.y < early.first - 5 && Math.abs(s.y - s.stops[0]) <= 2 && s.card === 'entrance', `mid-glide at ${early.y}, lands at ${s.y} (stop at ${s.stops[0]})`);
  // Coming to rest: timed as on the default entry (0.5 s, then 1.1 s).
  await page.evaluate((y) => {
    const p = window.__player;
    const glideTo = p.glideTo.bind(p);
    window.__asked = [];
    p.glideTo = (to, d, e) => (window.__asked.push(d), glideTo(to, d, e));
    window.__lenis.scrollTo(y, { immediate: true, force: true });
  }, s.stops[1] + 150);
  await page.waitForTimeout(100);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 30);
  const trail = await page.evaluate(() => new Promise((done) => {
    const t0 = performance.now();
    const out = [];
    const tick = () => {
      const t = performance.now() - t0;
      out.push([Math.round(t), Math.round(scrollY)]);
      if (t < 3000) requestAnimationFrame(tick);
      else done(out);
    };
    requestAnimationFrame(tick);
  }));
  const end = trail.at(-1)[1];
  const settled = trail.find(([t]) => t >= 350)?.[1];
  const from = trail.find(([t, y]) => t >= 350 && Math.abs(y - settled) > 4)?.[0] ?? -1;
  const asked = await page.evaluate(() => window.__asked);
  check('no GSAP, with Lenis: half a second after the scroll stops, a 1.1 s glide to the stop', Math.abs(end - s.stops[1]) <= 2 && from >= 400 && from <= 1300 && asked.length === 1 && asked[0] === 1.1 && !(await gsapLoaded(page)) && errors.length === 0 && !warnings.some((w) => w.includes('need Lenis')), `starts ${from} ms, asked for ${asked.join(', ')} s, ends ${end} (stop at ${s.stops[1]})`);
});

// ---- what the final review fixed
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const said = (list, text) => list.some((w) => w.includes(text));

// A script that runs while the page is still arriving meets the element
// before its children: the player waits for them.
for (const mode of ['', 'stills']) {
  await session(COMPUTER, async (page, { errors }) => {
    await page.goto(`${base}/stream${mode ? `?mode=${mode}` : ''}`, { waitUntil: 'load' });
    const ok = await ready(page, "document.getElementById('player')");
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const p = document.getElementById('player');
      return {
        early: window.__early,
        labels: p.querySelectorAll('.ft__label').length,
        placed: p.querySelectorAll('.ft__overlays > [data-stop], .ft__still > [data-stop]').length,
        moments: p.querySelectorAll('.ft__overlays > [data-moment], .ft__still > [data-moment]').length,
        stills: p.querySelectorAll('.ft__still').length,
        left: p.querySelectorAll(':scope > [data-stop], :scope > [data-moment], :scope > [data-poster]').length,
        meter: document.getElementById('meter').style.getPropertyValue('--ft-progress'),
      };
    });
    if (mode) check('a script that runs early, stills: the cards and the moment are in their stills', ok && r.early === 0 && r.stills === 3 && r.placed === 2 && r.moments === 1 && r.left === 0 && errors.length === 0, JSON.stringify(r));
    else check('a script that runs early: cards, labels, poster and --ft-progress as usual', ok && r.early === 0 && r.labels === 2 && r.placed === 2 && r.moments === 1 && r.left === 0 && Number(r.meter) > 0 && errors.length === 0, JSON.stringify(r));
  });
}

// src set after the element is in the page: the player starts then.
await session(COMPUTER, async (page, { errors, warnings }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  const make = () =>
    page.evaluate(() => {
      document.querySelectorAll('fly-through').forEach((p) => p.remove());
      const el = document.createElement('fly-through');
      el.innerHTML = '<div data-stop="a" data-frame="49" data-label="A">Card A</div>';
      document.body.prepend(el);
      window.__late = el;
    });
  // In the same task as it is added: nothing is said.
  await page.evaluate(() => {
    document.querySelectorAll('fly-through').forEach((p) => p.remove());
    const el = document.createElement('fly-through');
    el.innerHTML = '<div data-stop="a" data-frame="49" data-label="A">Card A</div>';
    document.body.prepend(el);
    el.setAttribute('src', '/tour/manifest.json');
    window.__late = el;
  });
  const same = await ready(page, 'window.__late');
  const quiet = !said(warnings, 'missing src');
  // Later: the console has said src is missing; the player still starts.
  await make();
  await page.waitForTimeout(200);
  const warned = said(warnings, 'missing src');
  const before = await page.evaluate(() => ({ track: !!window.__late.querySelector('.ft__track'), built: window.__late.built }));
  await page.evaluate(() => window.__late.setAttribute('src', '/tour/manifest.json'));
  const later = await ready(page, 'window.__late');
  const r = await page.evaluate(() => ({ labels: window.__late.querySelectorAll('.ft__label').length, cards: window.__late.querySelectorAll('.ft__overlays > [data-stop]').length }));
  check('src set in the task the element is added in: it starts, nothing said', same && quiet, `ready ${same}, warned ${!quiet}`);
  check('src set later: the console said it was missing, then the player starts', warned && !before.track && later && r.labels === 1 && r.cards === 1 && errors.length === 0, `warned ${warned}, ${JSON.stringify(before)}, ready ${later}, ${JSON.stringify(r)}`);
});

// What the player shows behind the loading screen and when the screen
// lifts, read as the ready event fires (before the redraw that follows).
const atReady = () => {
  document.addEventListener(
    'flythrough-ready',
    (e) => {
      const p = e.target;
      window.__atReady = { drawn: p.drawn, frame: p.frame, waited: p.liftWaitOver, y: Math.round(scrollY), holds: p.holdsPage };
    },
    true,
  );
};

// The browsers' own 8px margin on body: the page opens above the player.
await session(COMPUTER, async (page, { warnings }) => {
  await page.addInitScript(atReady);
  await page.goto(`${base}/?above=0&intro=1&margin=8`, { waitUntil: 'load' });
  const ok = await ready(page);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ ...window.__atReady, after: Math.round(scrollY) }));
  check('a page margin: the console says why the tour does not open', ok && said(warnings, '8px below the top of the page') && r.after === 0, `scrollY ${r.after}; ${warnings.filter((w) => w.includes('margin')).length} warning(s)`);
  check('a page margin: the loading screen lifts on the frame the page is at, without the wait', r.drawn === r.frame && r.frame === 0 && !r.waited, JSON.stringify(r));
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0&intro=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  check('no margin: nothing is said about one', !said(warnings, 'below the top of the page'), warnings.join(' | '));
});

// Content above the player: the page opens above it, on frame 1, and is
// not held when the visitor scrolls into the player while it loads.
await session(COMPUTER, async (page, { errors }) => {
  await page.addInitScript(atReady);
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await sleep(700);
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?intro=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__player.booted, null, { timeout: 15000 });
  await page.mouse.move(700, 450);
  // Into the track (the content above is a screen and a half), then on.
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  const in1 = await page.evaluate(() => ({ y: Math.round(scrollY), top: Math.round(window.__player.rangeTop()), ready: window.__player.ready }));
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(400);
  const in2 = await page.evaluate(() => ({ y: Math.round(scrollY), ready: window.__player.ready, veil: !!document.querySelector('.ft__loading') }));
  check('a player further down, still loading: the visitor scrolls into it and on', in1.y > in1.top && !in1.ready && in2.y >= in1.y + 400 && !in2.ready && in2.veil, `track from ${in1.top}; y ${in1.y} then ${in2.y}`);
  const ok = await ready(page);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ ...window.__atReady, frame2: window.__player.frame, drawn2: window.__player.drawn }));
  check('a player further down: it opens on the page\'s place and does not hold the page', ok && r.holds === false && !r.waited && r.drawn2 === r.frame2 && errors.length === 0, JSON.stringify(r));
});
await session(COMPUTER, async (page) => {
  await page.addInitScript(atReady);
  await page.goto(`${base}/?aboveh=120`, { waitUntil: 'load' });
  const ok = await ready(page);
  const r = await page.evaluate(() => window.__atReady);
  check('opening above the player: frame 1 behind the loading screen, lifted without the wait', ok && r.drawn === 0 && r.frame === 0 && !r.waited && r.y === 0, JSON.stringify(r));
});
await session(COMPUTER, async (page) => {
  await page.addInitScript(atReady);
  await page.goto(`${base}/?above=0&intro=1`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => window.__atReady);
  check('opening at the top: the page is held while it loads, as before', r.holds === true && !r.waited, JSON.stringify(r));
});

// At rest the picture is one frame: the mix of two runs out.
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&snap=off&return=off`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForFunction(() => window.__player.hasAttribute('loaded'), null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const p = window.__player;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // A place half way between two frames, reached a pixel at a time.
    let y = Math.round(p.yFor(0.3));
    let part = 0;
    for (let k = 0; k < 80; k++) {
      window.scrollTo(0, ++y);
      await frame();
      part = p.framePos % 1;
      if (part > 0.4 && part < 0.6) break;
    }
    await wait(80);
    const moving = { a: p.shownA, b: p.shownB };
    let events = 0;
    p.addEventListener('flythrough-progress', () => events++);
    await wait(900);
    const rest = { a: p.shownA, b: p.shownB, nearest: Math.round(p.framePos), events };
    // The page moves again: the mix is back.
    window.scrollTo(0, y + 1);
    await frame();
    await wait(60);
    const again = { b: p.shownB, part: p.framePos % 1 };
    return { part, moving, rest, again };
  });
  check('between two frames, while the page moves: the two are mixed', r.part > 0.4 && r.part < 0.6 && r.moving.b === r.moving.a + 1, JSON.stringify(r.moving));
  check('at rest: the picture is the nearer frame alone, with no event for it', r.rest.b === -1 && r.rest.a === r.rest.nearest && r.rest.events === 0 && errors.length === 0, JSON.stringify(r.rest));
  check('moving again: mixed again', r.again.part < 0.05 || r.again.part > 0.95 || r.again.b >= 0, JSON.stringify(r.again));
});

// A host that stops answering: the loading screen does not stay for good.
// The three cases run side by side (each waits the player's 20 s). What the
// player says is read in the page: an Error handed to console.error reads
// differently in each browser's console.
const keepSaid = () => {
  window.__said = [];
  for (const kind of ['error', 'warn']) {
    const real = console[kind];
    console[kind] = (...args) => {
      window.__said.push(args.map((a) => String(a?.message ?? a)).join(' '));
      real.apply(console, args);
    };
  }
};
const saidInPage = async (page, text) => said(await page.evaluate(() => window.__said), text);
{
  const timed = async (page, done) => {
    const t0 = Date.now();
    const ok = await page.waitForFunction(done, null, { timeout: 32000 }).then(() => true, () => false);
    return { ok, s: (Date.now() - t0) / 1000 };
  };
  await Promise.all([
    session(COMPUTER, async (page) => {
      await page.addInitScript(keepSaid);
      await page.route('**/tour/landscape/*.webp', () => {});
      await page.goto(`${base}/?above=0`, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__player?.booted, null, { timeout: 15000 });
      const t = await timed(page, () => window.__player.hasAttribute('error'));
      const r = await page.evaluate(() => ({ h: window.__player.offsetHeight, veil: !!document.querySelector('.ft__loading') }));
      await page.mouse.move(700, 450);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(300);
      const y = await page.evaluate(() => Math.round(scrollY));
      check('frames that never answer: the player steps aside after 20 s', t.ok && t.s > 18 && t.s < 26 && r.h === 0 && !r.veil && (await saidInPage(page, 'no frame arrived in 20 s')) && y > 0, `after ${t.s.toFixed(1)} s, height ${r.h}, the page scrolls to ${y}`);
    }),
    session(COMPUTER, async (page) => {
      await page.addInitScript(keepSaid);
      let let_ = 20;
      await page.route('**/tour/landscape/*.webp', (route) => (let_-- > 0 ? route.continue() : undefined));
      await page.goto(`${base}/?above=0`, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__player?.loadedCount >= 20, null, { timeout: 15000 });
      const t = await timed(page, () => window.__player.hasAttribute('ready'));
      const r = await page.evaluate(() => ({ drawn: window.__player.drawn, error: window.__player.hasAttribute('error'), in: window.__player.loadedCount }));
      check('frames that stop arriving: the loading screen lifts on what is in after 20 s', t.ok && t.s > 18 && t.s < 26 && r.drawn >= 0 && !r.error && (await saidInPage(page, 'frames stopped arriving')), `after ${t.s.toFixed(1)} s, ${r.in} frames in, frame ${r.drawn} drawn`);
    }),
    session(COMPUTER, async (page) => {
      await page.addInitScript(keepSaid);
      await page.route('**/tour/manifest.json', () => {});
      await page.goto(`${base}/?above=0`, { waitUntil: 'commit' });
      await page.waitForFunction(() => !!window.__player, null, { timeout: 15000 });
      const t = await timed(page, () => window.__player.hasAttribute('error'));
      const r = await page.evaluate(() => ({ h: window.__player.offsetHeight }));
      check('a manifest that never answers: the player steps aside after 20 s', t.ok && t.s > 18 && t.s < 26 && r.h === 0 && (await saidInPage(page, 'manifest /tour/manifest.json did not answer in 20 s')), `after ${t.s.toFixed(1)} s, height ${r.h}`);
    }),
  ]);
}

// The connection drops for a few seconds while the frames load: none is
// given up on, all arrive once it is back.
await session(COMPUTER, async (page, { ctx, errors }) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await sleep(60);
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  const before = await page.evaluate(() => window.__player.loadedCount);
  await ctx.setOffline(true);
  await page.waitForTimeout(6000);
  const off = await page.evaluate(() => ({ online: navigator.onLine, failed: window.__player.failedCount, in: window.__player.loadedCount }));
  await ctx.setOffline(false);
  const all = await page.waitForFunction(() => window.__player.hasAttribute('loaded'), null, { timeout: 90000 }).then(() => true, () => false);
  const r = await page.evaluate(() => ({ failed: window.__player.failedCount, in: window.__player.loadedCount, of: window.__player.loaded.length }));
  check('offline for 6 s while loading: no frame is given up on, all arrive after', off.online === false && off.failed === 0 && before < r.of && all && r.failed === 0 && r.in === r.of && errors.length === 0, `${before} in before, offline: ${JSON.stringify(off)}, after: ${JSON.stringify(r)}`);
});

// A waiting player gets its height while the visitor is below it (a link
// to a later section, the End key): they stay on what they were reading.
// With Lenis, mid-glide, the page was pulled back by the track's height.
for (const lenis of [0, 1]) {
  await session(COMPUTER, async (page, { errors }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    await page.route('**/tour/manifest.json', async (route) => {
      await gate;
      route.continue().catch(() => {});
    });
    await page.goto(`${base}/?aboveh=400&lenis=${lenis}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(800);
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(120);
    const look = () => page.evaluate(() => ({ below: Math.round(document.getElementById('below').getBoundingClientRect().top), h: window.__player.offsetHeight, y: Math.round(scrollY) }));
    const before = await look();
    release();
    const grew = await page.waitForFunction((h) => window.__player.offsetHeight > h + 1000, before.h, { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(1200);
    const after = await look();
    check(`a waiting player gets its height above the visitor${lenis ? ', Lenis' : ''}: they stay where they read`, grew && Math.abs(after.below - before.below) <= 260 && after.y > before.y + 1000 && errors.length === 0, `the content below at ${before.below} then ${after.below} px on screen; the player ${before.h} then ${after.h} px tall; scrollY ${before.y} then ${after.y}`);
  });
}

// Content above the player changes height after it has loaded (a picture
// arriving late, an accordion): the player still knows where its track is.
for (const lenis of [0, 1]) {
  await session(COMPUTER, async (page, { errors }) => {
    await page.goto(`${base}/?snap=off&return=off&lenis=${lenis}`, { waitUntil: 'load' });
    await ready(page);
    const at = () =>
      page.evaluate(async () => {
        const p = window.__player;
        const track = p.querySelector('.ft__track');
        const top = Math.round(track.getBoundingClientRect().top + scrollY);
        window.__lenis ? window.__lenis.scrollTo(top + 720, { immediate: true, force: true }) : window.scrollTo(0, top + 720);
        await new Promise((r) => setTimeout(r, 700));
        return { top, y: Math.round(scrollY), position: p.position, want: 720 / (track.offsetHeight - innerHeight), frame: p.frame };
      });
    const before = await at();
    await page.evaluate(() => (document.getElementById('above').style.minHeight = 'calc(150vh + 720px)'));
    await page.waitForTimeout(500);
    const after = await at();
    await page.evaluate(() => window.__player.goToStop(2));
    // Until it lands, not a fixed time: Playwright's WebKit for Windows
    // freezes the page for half a second to seconds during a flight (it
    // decodes the pictures on the page's own thread), and GSAP does not
    // skip the flight ahead over a freeze, so 1.8 s can take 5.
    const where = () => {
      const p = window.__player;
      const track = p.querySelector('.ft__track');
      return { y: Math.round(scrollY), want: Math.round(track.getBoundingClientRect().top + scrollY + p.stopScroll[2] * (track.offsetHeight - innerHeight)) };
    };
    await page
      .waitForFunction(
        () => {
          const p = window.__player;
          const track = p.querySelector('.ft__track');
          return Math.abs(scrollY - (track.getBoundingClientRect().top + scrollY + p.stopScroll[2] * (track.offsetHeight - innerHeight))) <= 2;
        },
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(600);
    const land = await page.evaluate(where);
    const tag = `content above grows by 720 px${lenis ? ', Lenis' : ''}`;
    check(`${tag}: the same place in the track shows the same frame`, after.top === before.top + 720 && Math.abs(after.position - after.want) < 0.002 && after.frame === before.frame && errors.length === 0, `before ${JSON.stringify(before)}; after ${JSON.stringify(after)}`);
    check(`${tag}: a label flight lands on its stop`, Math.abs(land.y - land.want) <= 2, `landed at ${land.y}, the stop is at ${land.want}`);
  });
}

// Wrong turns are said in the console.
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => {
    document.querySelectorAll('fly-through').forEach((p) => p.remove());
    const el = document.createElement('fly-through');
    el.setAttribute('src', '/tour/manifest.json');
    el.setAttribute('stops', JSON.stringify([{ id: 'a', frame: 49 }, { id: 'late', frame: 5000 }]));
    el.innerHTML = '<div data-stop="a">A</div><div data-stop="late">Late</div><div data-stop="ghost">Ghost</div><p data-moment="m" data-from="162" data-to="240">By frame, in the wrong attributes</p><p data-moment="ok" data-from="0.2" data-to="0.3">Fine</p>';
    document.body.prepend(el);
    window.__odd = el;
  });
  await ready(page, 'window.__odd');
  const r = await page.evaluate(() => ({ stops: window.__odd.stopList.length, last: window.__odd.stopList.at(-1).at, moments: window.__odd.moments.length }));
  check('a stop written past the end: said, and put on the last frame', said(warnings, 'stop "late" is past the end of the footage (720 frames)') && r.stops === 2 && r.last === 1, JSON.stringify(r));
  check('a card that matches no stop: said', said(warnings, 'data-stop="ghost" matches no stop') && !said(warnings, 'data-stop="a" matches'), warnings.filter((w) => w.includes('matches no stop')).join(' | '));
  check('a moment with frame numbers in data-from and data-to: said, left out', said(warnings, 'a moment needs data-from below data-to') && r.moments === 1, `${r.moments} moment(s)`);
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/static.html?nocss=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(200);
  check('the stylesheet forgotten: said', said(warnings, "the stylesheet is missing: import 'flythrough/style.css'"), warnings.join(' | ').slice(0, 200));
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/static.html`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(200);
  check('with the stylesheet: nothing said about it', !said(warnings, 'stylesheet'), warnings.join(' | ').slice(0, 200));
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?gsap=0&lenis=0&above=0&intro=1`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ y: Math.round(scrollY), first: Math.round(window.__player.yFor(window.__player.stopScroll[0])) }));
  check('no GSAP, no Lenis, intro: opens on the first stop, and the console says why', said(warnings, 'the intro opens on the first stop') && Math.abs(r.y - r.first) <= 2, JSON.stringify(r));
});

// "false" turns off what "off" does.
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&intro=1&snap=false&return=false&bar=false`, { waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => ({ snap: window.__player.snapOn, back: window.__player.returnFirst, bar: !!window.__player.querySelector('.ft__bar') }));
  check('snap, return-to-first and bar: "false" is off', r.snap === false && r.back === false && r.bar === false, JSON.stringify(r));
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&intro=1&autoscroll=false`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(2500);
  const y = await page.evaluate(() => Math.round(scrollY));
  check('autoscroll: "false" is off, the page stays where it opened', y === 0, `scrollY ${y}`);
});

// Before the player's script has arrived: one screen (or its box), so what
// is below it is not at the top of the screen.
for (const stage of ['', '60']) {
  await session(COMPUTER, async (page) => {
    await page.goto(`${base}/static.html?wait=1&noposter=1${stage ? `&stage=${stage}` : ''}`, { waitUntil: 'load' });
    const r = await page.evaluate(() => ({ h: window.__player.offsetHeight, vh: innerHeight, defined: window.__player.matches(':defined'), below: Math.round(document.getElementById('below').getBoundingClientRect().top) }));
    const want = stage ? Math.round((r.vh * Number(stage)) / 100) : r.vh;
    check(`before the script${stage ? ', a box' : ''}: the player keeps its ${stage ? 'box' : 'screen'}`, !r.defined && Math.abs(r.h - want) <= 1 && Math.abs(r.below - want) <= 1, JSON.stringify(r));
  });
}

// README's recipe for keeping the place on a reload (static.ts runs it).
// The recipe learns of a scroll at the player's next progress event, a
// screen frame later, and then switches the browser's own restoring: that
// switch is waited for before a reload, not a fixed time. (A browser that
// drew no frame for 400 ms once reloaded before the recipe knew of the
// scroll; measured, the event comes 3 to 45 ms after it, also with the
// processor slowed twelve times.)
const recipeIs = (page, mode) => page.waitForFunction((m) => history.scrollRestoration === m, mode, { timeout: 5000 }).then(() => true, () => false);
for (const [name, q] of [
  ['a page that is only the tour', 'below=0'],
  ['content above and below', 'aboveh=150'],
]) {
  await session(COMPUTER, async (page, { errors }) => {
    await page.goto(`${base}/static.html?keep=1&${q}`, { waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, window.__player.yFor(0.6)));
    await recipeIs(page, 'manual');
    await page.waitForTimeout(900);
    const before = await page.evaluate(() => ({ y: Math.round(scrollY), at: window.__player.position }));
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({ y: Math.round(scrollY), at: window.__player.position, mode: history.scrollRestoration }));
    check(`reload recipe, ${name}: back at the same place in the tour`, before.at > 0.5 && Math.abs(after.at - before.at) < 0.003 && Math.abs(after.y - before.y) <= 3 && after.mode === 'manual' && errors.length === 0, `before ${JSON.stringify(before)}; after ${JSON.stringify(after)}`);
  });
}
// A window resize makes GSAP's ScrollTrigger measure everything again, and
// at the end of that it wrote back the history.scrollRestoration it found
// when it started ("auto" on a first visit): the browser then put the
// scroll back on a reload as well, and the visitor was left at the end of
// the tour (src/gsap-engine.ts now tells it the page's value first).
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/static.html?keep=1&aboveh=150`, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, window.__player.yFor(0.6)));
  await recipeIs(page, 'manual');
  await page.waitForTimeout(400);
  // Narrower only: the track keeps its height, so the place stays 0.6.
  await page.setViewportSize({ width: 1300, height: 900 });
  // ScrollTrigger measures again 0.2 s after a resize.
  await page.waitForTimeout(900);
  const resized = await page.evaluate(() => ({ at: window.__player.position, mode: history.scrollRestoration }));
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ at: window.__player.position, mode: history.scrollRestoration }));
  check(
    'reload recipe: a window resize inside the tour does not undo it',
    resized.mode === 'manual' && Math.abs(resized.at - 0.6) < 0.003 && Math.abs(after.at - 0.6) < 0.003 && after.mode === 'manual' && errors.length === 0,
    `after the resize ${JSON.stringify(resized)}; after the reload ${JSON.stringify(after)}`,
  );
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/static.html?keep=1&aboveh=150`, { waitUntil: 'load' });
  await ready(page);
  // Nothing saved from outside the tour: a reload is the browser's own.
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  const r = await page.evaluate(() => ({ mode: history.scrollRestoration, saved: sessionStorage.getItem('tour-place') }));
  // Then into the tour and out again: the place is dropped as they leave.
  await page.evaluate(() => window.scrollTo(0, window.__player.yFor(0.6)));
  await recipeIs(page, 'manual');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ at: window.__player.position, mode: history.scrollRestoration }));
  await page.evaluate(() => window.scrollTo(0, 0));
  const left = await recipeIs(page, 'auto');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  const out = await page.evaluate(() => ({ mode: history.scrollRestoration, saved: sessionStorage.getItem('tour-place') }));
  check(
    'reload recipe: left from above the tour after a visit inside it, the place is dropped',
    left && Math.abs(back.at - 0.6) < 0.003 && back.mode === 'manual' && out.mode === 'auto' && out.saved === null,
    `${JSON.stringify(back)}; ${JSON.stringify(out)}${left ? '' : '; the recipe never learnt of the jump out'}`,
  );
  check('reload recipe: outside the tour nothing is saved, the browser restores', r.mode === 'auto' && r.saved === null, JSON.stringify(r));
});

// ---- attributes and properties
// React, Vue and Svelte set a prop as a property when the element has one of
// that name, and as an attribute otherwise. The player reads attributes, so
// none of its attributes (README.md's table) may also be a property, as
// written or in camelCase.
await session(COMPUTER, async (page) => {
  const readme = readFileSync('README.md', 'utf8');
  const table = readme.slice(readme.indexOf('## Attributes'), readme.indexOf('### Stops'));
  const names = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  await ready(page);
  const clash = await page.evaluate((names) => {
    const camel = (n) => n.replace(/-(.)/g, (_, c) => c.toUpperCase());
    return names.filter((n) => n in window.__player || camel(n) in window.__player);
  }, names);
  check('no attribute is also a property of the element', names.length >= 16 && clash.length === 0, `${names.length} attributes; clashing: ${clash.join(', ') || 'none'}`);
});

await browser.close();
await server.close();
rmSync(avifDir, { recursive: true, force: true });
console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${which}: ${rows.length - failed} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
