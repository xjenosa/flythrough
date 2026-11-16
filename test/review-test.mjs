// Browser checks from the release review, on the host page (test/host/):
// failing frames, broken manifests, frames from another origin, drawing
// without createImageBitmap, plain-text labels, removal and re-adding, two
// players, host layouts that break the player, the page held still while
// loading, keyboard and screen-reader names, reduced motion, names and
// colours, rotation and a phone's address bar, the loading screen's number,
// fade and holds (holdLoading), a writable position, hold without legs.
//   node test/review-test.mjs [--browser chromium|firefox|webkit]
import { chromium, firefox, webkit, devices } from '../tools/tidy-browser.cjs';
import { serveHost } from './host/serve.mjs';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
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
const COMPUTER = { viewport: { width: 1440, height: 900 } };
// Firefox has no isMobile; a phone there is a small touch viewport.
const PHONE = which === 'firefox' ? { viewport: { width: 390, height: 664 }, hasTouch: true } : { ...devices['iPhone 14'] };

// Handler names the player adds to window (class field arrows keep the
// field's name): none may stay after the player is removed.
const PLAYER_HANDLERS = ['onTouch', 'onNativeScroll', 'onNativeWheel', 'onNativeInput', 'onNativeKey', 'onResize'];
const trackListeners = () => {
  const live = new Map();
  const key = (t, f, o) => `${t}|${typeof o === 'boolean' ? o : !!o?.capture}|${f?.name}`;
  const add = window.addEventListener;
  const remove = window.removeEventListener;
  window.addEventListener = function (t, f, o) {
    const k = key(t, f, o);
    if (!live.has(k)) live.set(k, new Set());
    live.get(k).add(f);
    return add.call(this, t, f, o);
  };
  window.removeEventListener = function (t, f, o) {
    live.get(key(t, f, o))?.delete(f);
    return remove.call(this, t, f, o);
  };
  // Not Lenis's own scroll listener, which has one of these names too
  // (onNativeScroll) and stays as long as the host's Lenis does.
  window.__listeners = (names) => [...live].filter(([k, s]) => [...s].some((f) => f !== window.__lenis?.onNativeScroll) && names.includes(k.split('|')[2])).map(([k]) => k);
};

async function session(opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && warnings.push(m.text()));
  await page.addInitScript(trackListeners);
  try {
    await fn(page, { errors, warnings, ctx });
  } finally {
    await ctx.close();
  }
  return errors;
}

function check(name, ok, detail = '') {
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(58)} ${detail}`);
}
const ready = (page, sel = 'window.__player', timeout = 30000) =>
  page.waitForFunction((s) => eval(s)?.hasAttribute('ready'), sel, { timeout }).then(() => true, () => false);
const info = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    return { y: Math.round(scrollY), stops: p.stopScroll.map((s) => Math.round(p.yFor(s))), card: document.querySelector('[data-stop][data-active]')?.dataset.stop ?? null };
  });
// A glide runs long on a starved computer: Playwright's WebKit draws a
// flight at a few pictures a second there, and GSAP counts a gap of over
// half a second between two of them as 33 ms. A row that only waits the
// glide's length then reads a glide still under way as one that stopped
// short. These two tell them apart: countStopped counts the glides something
// ended before they arrived (the take-over check, onGlideScroll, among
// them), and arrives waits on, after the row's own wait, for the page to
// get there.
const countStopped = (page) =>
  page.evaluate(() => {
    const p = window.__player;
    window.__stopped = 0;
    const stopGlide = p.stopGlide.bind(p);
    p.stopGlide = () => {
      if (p.glideNow) window.__stopped++;
      return stopGlide();
    };
  });
const arrives = async (page, y) => {
  const there = () => page.evaluate((y) => Math.abs(scrollY - y) <= 2 && !window.__player.glideNow, y);
  const onTime = await there();
  const t0 = Date.now();
  if (!onTime) await page.waitForFunction((y) => Math.abs(scrollY - y) <= 2 && !window.__player.glideNow, y, { timeout: 20000 }).catch(() => {});
  const stopped = await page.evaluate(() => window.__stopped);
  return { stopped, note: `${onTime ? '' : `; still gliding at the check, there ${Date.now() - t0} ms later`}${stopped ? `; ${stopped} glide(s) stopped before arriving` : ''}` };
};
const wheelAt = async (page, dy) => {
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, dy);
};

// ---- failure
await session(COMPUTER, async (page, { errors, warnings }) => {
  const hits = new Map();
  await page.route('**/tour/landscape/*.webp', (route) => {
    const f = route.request().url().split('/').pop();
    hits.set(f, (hits.get(f) ?? 0) + 1);
    if (f === '0049.webp' && hits.get(f) <= 2) return route.abort();
    if (f === '0050.webp') return route.abort();
    return route.continue();
  });
  await page.goto(`${base}/?above=0`);
  const ok = await ready(page, 'window.__player', 20000);
  check('a frame failing twice is retried and loads', ok && hits.get('0049.webp') === 3, `0049 asked ${hits.get('0049.webp')} times`);
  check('a frame that never loads still lets the loading screen lift', ok && warnings.some((w) => w.includes('1 frames failed')), `${hits.get('0050.webp')} tries, ${errors.length} errors`);
});

await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?src=/nope/manifest.json`);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ err: window.__player.hasAttribute('error'), h: window.__player.offsetHeight, veil: !!document.querySelector('.ft__loading') }));
  check('a missing manifest collapses the player', r.err && r.h === 0 && !r.veil, `height ${r.h}, veil ${r.veil}`);
  void errors;
});

const collapsed = (page) =>
  page.evaluate(() => ({ err: window.__player.hasAttribute('error'), h: window.__player.offsetHeight, veil: !!document.querySelector('.ft__loading') }));
for (const [name, body] of [
  ['{}', '{}'],
  ['not JSON', '<!doctype html><p>Not found</p>'],
  ['a newer version', '{"version":2,"fps":24,"duration":1,"frames":24,"sets":{"a":{"width":10,"height":10,"pattern":"a/{i}.webp","pad":4}}}'],
]) {
  await session(COMPUTER, async (page, { warnings }) => {
    await page.route((u) => u.pathname === '/bad/manifest.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
    await page.goto(`${base}/?above=0&src=/bad/manifest.json`);
    await page.waitForTimeout(1500);
    const r = await collapsed(page);
    const y = await page.evaluate(() => (window.scrollBy(0, 300), scrollY));
    check(`a manifest that is ${name} collapses the player`, r.err && r.h === 0 && !r.veil && y > 0, `${warnings.find((w) => w.includes('manifest')) ?? 'no message'}`);
  });
}

for (const [name, handler, within] of [
  // WebKit loads frames as <img>s, which cannot see a 404, so it retries as for the network.
  ['answer 404', (route) => route.fulfill({ status: 404, body: 'gone' }), which === 'webkit' ? 6000 : 2500],
  ['fail on the network', (route) => route.abort(), 6000],
]) {
  await session(COMPUTER, async (page, { warnings }) => {
    await page.route('**/tour/landscape/*.webp', handler);
    const t0 = Date.now();
    await page.goto(`${base}/?above=0`);
    await page.waitForFunction(() => window.__player?.hasAttribute('error'), null, { timeout: 15000 }).catch(() => {});
    const ms = Date.now() - t0;
    const r = await collapsed(page);
    check(`every frame failing (${name}): the player collapses quickly`, r.err && r.h === 0 && !r.veil && ms < within, `${ms} ms; ${warnings.find((w) => w.includes('no frame')) ?? 'no message'}`);
  });
}

// Frames on another origin that sends no CORS header: fetch cannot read
// them, so the player falls back to <img>s. The manifest does send one. A
// plain server on its own port (Playwright's route.fulfill would add CORS).
{
  const other = http.createServer((req, res) => {
    const file = path.join('demo/public', decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!existsSync(file)) return res.writeHead(404).end();
    const json = file.endsWith('.json');
    res.writeHead(200, { 'content-type': json ? 'application/json' : 'image/webp', ...(json ? { 'access-control-allow-origin': '*' } : {}) });
    res.end(readFileSync(file));
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${other.address().port}`;
  await session(COMPUTER, async (page, { errors }) => {
    await page.goto(`${base}/?above=0&src=${origin}/tour/manifest.json`);
    const ok = await ready(page, 'window.__player', 30000);
    const s = await info(page);
    await page.evaluate((y) => window.scrollTo(0, y), s.stops[2]);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ img: window.__player.useImg, drawn: window.__player.drawn, frame: window.__player.frame }));
    check('frames on another origin without CORS: drawn as images', ok && r.img && Math.abs(r.drawn - r.frame) <= 1 && !errors.length, JSON.stringify(r));
  });
  other.closeAllConnections();
  other.close();
}

// A browser without createImageBitmap: frames are <img>s, as before.
await session(COMPUTER, async (page, { errors }) => {
  await page.addInitScript(() => (window.createImageBitmap = undefined));
  await page.goto(`${base}/?above=0`);
  const ok = await ready(page);
  const s = await info(page);
  await page.evaluate(() => window.__player.goToStop(3));
  await page.waitForTimeout(3600);
  const end = await info(page);
  const r = await page.evaluate(() => ({ img: window.__player.useImg, drawn: window.__player.drawn, frame: window.__player.frame }));
  check('without createImageBitmap: frames drawn as images, glides work', ok && r.img && r.drawn === r.frame && Math.abs(end.y - s.stops[3]) <= 2 && !errors.length, JSON.stringify(r));
});

// Drawing from decoded bitmaps: only a window of them is kept.
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.waitForFunction(() => window.__player.hasAttribute('loaded'), null, { timeout: 60000 });
  const s = await info(page);
  let most = 0;
  for (let k = 0; k <= 60; k++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(s.stops[0] + ((s.stops[4] - s.stops[0]) * k) / 60));
    await page.waitForTimeout(30);
    most = Math.max(most, await page.evaluate(() => window.__player.held.size));
  }
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ img: window.__player.useImg, held: window.__player.held.size, drawn: window.__player.drawn, frame: window.__player.frame }));
  // WebKit draws <img>s by design (see useImg in src/flythrough.ts).
  if (which === 'webkit') check('WebKit: frames drawn as images (its createImageBitmap is slow)', r.img && r.held === 0 && r.drawn === r.frame && !errors.length, JSON.stringify(r));
  else check('frames are decoded off the page: at most 36 kept at once', !r.img && most <= 36 && r.held > 0 && r.drawn === r.frame && !errors.length, `most ${most} held while scrubbing the whole flight, ${r.held} at rest`);
});

// Loading: twelve frames at once, and frames do not hold back the load event.
await session(COMPUTER, async (page) => {
  let now = 0;
  let most = 0;
  await page.route('**/tour/landscape/*.webp', async (route) => {
    most = Math.max(most, ++now);
    await new Promise((r) => setTimeout(r, 150));
    await route.continue().catch(() => {});
    now--;
  });
  await page.addInitScript(() => window.addEventListener('load', () => (window.__atLoad = window.__player?.loadedCount ?? -1)));
  await page.goto(`${base}/?above=0`, { waitUntil: 'load' });
  const atLoad = await page.evaluate(() => window.__atLoad);
  await ready(page);
  check('loading: twelve frames are asked for at once', most === 12, `${most} at most`);
  check('loading: frames do not hold back the page load event', atLoad >= 0 && atLoad < 100, `${atLoad} frames in when the page finished loading`);
});

// ---- safety
await session(COMPUTER, async (page) => {
  const label = '<img src=x onerror="window.__xss=1">Door';
  await page.goto(`${base}/?above=0&label=${encodeURIComponent(label)}`);
  await ready(page);
  const r = await page.evaluate(() => ({ text: document.querySelector('.ft__label span').textContent, imgs: document.querySelectorAll('.ft__bar img').length, xss: window.__xss }));
  check('stop labels are plain text', r.text === label && r.imgs === 0 && r.xss === undefined, JSON.stringify(r.text));
});

// ---- removal and re-adding
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&intro=1`);
  await ready(page);
  await page.waitForTimeout(3000);
  const before = await page.evaluate((n) => window.__listeners(n).length, PLAYER_HANDLERS);
  // The player's reading of the scroll: a ScrollTrigger, or without GSAP its own tracker.
  const countTriggers = () => page.evaluate(() => (window.__ST ? window.__ST.getAll().length : window.__player.st ? 1 : 0));
  const triggers = await countTriggers();
  await page.evaluate(() => {
    window.__parent = window.__player.parentNode;
    window.__next = window.__player.nextSibling;
    window.__player.remove();
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate((n) => window.__listeners(n), PLAYER_HANDLERS);
  const trigAfter = await countTriggers();
  check('removing the player drops its window listeners and trigger', before > 0 && after.length === 0 && trigAfter === triggers - 1, `${before} -> ${after.length} listeners${after.length ? ` (${after.join(', ')})` : ''}, triggers ${triggers} -> ${trigAfter}`);
  await page.evaluate(() => window.__parent.insertBefore(window.__player, window.__next));
  await page.waitForTimeout(500);
  const s = await info(page);
  await page.evaluate((y) => window.scrollTo(0, y), s.stops[1] + 150);
  await wheelAt(page, 40);
  await page.waitForTimeout(2400);
  const end = await info(page);
  check('a player put back works again (comes to rest)', Math.abs(end.y - end.stops[1]) <= 2, `y ${end.y}, stop 2 at ${end.stops[1]}`);
  check('no page errors around removal', errors.length === 0, errors.join(' | '));
});

await session(COMPUTER, async (page, { errors }) => {
  let frames = 0;
  await page.route('**/tour/landscape/*.webp', async (route) => {
    frames++;
    await new Promise((r) => setTimeout(r, 300));
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0&intro=1`);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__player.remove());
  await page.waitForTimeout(1000);
  const atRemoval = frames;
  await page.waitForTimeout(2000);
  const y = await page.evaluate(() => scrollY);
  check('removed while loading: stops asking for frames, never scrolls', frames - atRemoval <= 12 && y === 0 && errors.length === 0, `${frames - atRemoval} more requests, scrollY ${y}`);
});

// ---- two players
await session(COMPUTER, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&two=1`);
  const first = await ready(page);
  // The second is far down the page, so it has not started (lazy start);
  // bringing it to the screen does.
  const waited = await page.evaluate(() => !window.__second.manifest);
  await page.evaluate(() => window.__second.scrollIntoView());
  const ok = first && waited && (await ready(page, 'window.__second'));
  const r = await page.evaluate(() => {
    const ys = (p) => p.stopScroll.map((s) => Math.round(p.yFor(s)));
    return { a: ys(window.__player), b: ys(window.__second) };
  });
  await page.evaluate((y) => window.scrollTo(0, y), r.b[1] + 150);
  await wheelAt(page, 40);
  await page.waitForTimeout(2400);
  const y2 = await page.evaluate(() => Math.round(scrollY));
  await page.evaluate((y) => window.scrollTo(0, y), r.a[2] - 150);
  await wheelAt(page, 40);
  await page.waitForTimeout(2400);
  const y1 = await page.evaluate(() => Math.round(scrollY));
  check('two players: each comes to rest on its own stops', ok && Math.abs(y2 - r.b[1]) <= 2 && Math.abs(y1 - r.a[2]) <= 2, `second ${y2}/${r.b[1]}, first ${y1}/${r.a[2]}`);
  check('two players: no page errors', errors.length === 0, errors.join(' | '));
});

// ---- a page scrolling inside a box
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?box=1`);
  await page.waitForTimeout(2000);
  check('a page scrolling inside a box gets a console warning', warnings.some((w) => w.includes('scrolls inside a box')));
});
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/`);
  await ready(page);
  check('an ordinary page gets no layout warning', !warnings.some((w) => w.includes('scrolls inside a box') || w.includes('overflow')));
});
for (const [wrap, warned] of [['hidden', true], ['clip', false]]) {
  await session(COMPUTER, async (page, { warnings }) => {
    await page.goto(`${base}/?above=0&wrap=${wrap}`);
    await ready(page);
    const s = await info(page);
    await page.evaluate((y) => window.scrollTo(0, y), s.stops[2]);
    await page.waitForTimeout(300);
    const top = await page.evaluate(() => Math.round(window.__player.querySelector('.ft__stage').getBoundingClientRect().top));
    const w = warnings.some((x) => x.includes('use overflow: clip'));
    check(`a wrapper with overflow-x: ${wrap}: ${warned ? 'a console warning' : 'no warning, the picture stays pinned'}`, warned ? w : !w && top === 0, `stage top ${top}`);
  });
}

// ---- held still while loading
await session(COMPUTER, async (page) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0`);
  await page.waitForSelector('.ft__loading');
  await page.waitForFunction(() => window.__player.drawn >= 0, null, { timeout: 10000 }).catch(() => {});
  const before = await page.evaluate(() => ({ y: scrollY, drawn: window.__player.drawn }));
  await wheelAt(page, 800);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ y: scrollY, drawn: window.__player.drawn, veil: !window.__player.ready }));
  check('loading screen filling the screen: the page is held still', after.veil && after.y === before.y, `scrollY ${before.y} -> ${after.y}`);
  check('loading: the picture behind the screen stays on the opening frame', before.drawn >= 0 && after.drawn === before.drawn, `frame ${before.drawn} -> ${after.drawn}`);
});
await session(COMPUTER, async (page) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    route.continue().catch(() => {});
  });
  await page.addInitScript(() => {
    const mo = new MutationObserver(() => {
      if (window.__player?.hasAttribute('intro-reveal')) window.__reveal = true;
    });
    mo.observe(document, { attributes: true, subtree: true, attributeFilter: ['intro-reveal'] });
  });
  await page.goto(`${base}/?above=0&intro=1`);
  await page.waitForSelector('.ft__loading');
  await page.waitForTimeout(300);
  await wheelAt(page, 600);
  await ready(page);
  await page.waitForTimeout(3500);
  const s = await info(page);
  const reveal = await page.evaluate(() => !!window.__reveal);
  check('a scroll while loading, with intro: held, and the intro still plays to the first stop', reveal && Math.abs(s.stops[0] - s.y) <= 2, `${reveal ? '' : 'no intro, '}y ${s.y}, first stop ${s.stops[0]}`);
});
await session(COMPUTER, async (page) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/`);
  await page.waitForSelector('.ft__loading');
  await wheelAt(page, 300);
  await page.waitForTimeout(500);
  const y = await page.evaluate(() => scrollY);
  check('loading, host content above on screen: the page scrolls', y > 200, `scrollY ${y}`);
});
await session(COMPUTER, async (page) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0`);
  await page.waitForSelector('.ft__loading');
  await page.waitForTimeout(300);
  const y0 = await page.evaluate(() => scrollY);
  await page.locator('.ft__label').nth(3).click();
  await page.evaluate(() => window.__player.goToStop(4));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ y: scrollY, veil: !!document.querySelector('.ft__loading:not(.ft__loading--done)') }));
  check('loading: a label tap or goToStop leaves the page where it is', r.veil && r.y === y0, `scrollY ${y0} -> ${r.y}`);
});

// ---- keyboard and screen readers
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.waitForTimeout(800);
  const s = await info(page);
  await countStopped(page);
  await page.getByRole('button', { name: 'Terrace' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3600);
  const late = await arrives(page, s.stops[3]);
  const end = await info(page);
  check('keyboard: Enter on a stop label flies there', Math.abs(end.y - s.stops[3]) <= 2 && end.card === 'terrace' && late.stopped === 0, `y ${end.y}, stop 4 at ${s.stops[3]}, card ${end.card}${late.note}`);
  const nav = await page.getByRole('navigation', { name: 'Tour progress' }).count();
  check('the stop bar is a named navigation landmark', nav === 1);
  const cur = await page.locator('.ft__label[aria-current="step"]').count();
  check('one label is marked as the current step', cur === 1);
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.waitForTimeout(800);
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  // Playwright's WebKit Tab skips links (Safari's default), so there the Tab
  // order is read from the page: what Tab can reach after the focused label.
  const nextTab = () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll('fly-through button, fly-through a[href]')].filter((el) => el.tabIndex >= 0 && el.checkVisibility({ visibilityProperty: true }));
      return all[all.indexOf(document.activeElement) + 1]?.textContent.trim() ?? '';
    });
  const tabOn = async () => {
    if (which !== 'webkit') {
      await page.keyboard.press('Tab');
      return focused();
    }
    return nextTab();
  };
  // A place on the screen, not a point of the body: Playwright scrolls a
  // locator's point into view first, which took the page from the first stop
  // to the very top, where no card shows.
  await page.mouse.click(5, 5);
  await page.keyboard.press('Tab');
  const first = await focused();
  const second = await tabOn();
  check('keyboard: Tab reaches the current label, then the showing card', first === 'Entrance' && second === 'More about Entrance', `${first} -> ${second}`);
  if (which !== 'webkit') await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowRight');
  const moved = await focused();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2600);
  const card = await tabOn();
  const stops = await page.evaluate(() => [...document.querySelectorAll('.ft__label')].filter((b) => b.tabIndex === 0).length);
  check('keyboard: arrows move along the labels; after flying, Tab is the card', moved === 'Lobby' && card === 'More about Lobby' && stops === 1, `${moved}, then ${card}; ${stops} label in the Tab order`);
});
await session(PHONE, async (page) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  const names = await page.evaluate(() => [...document.querySelectorAll('.ft__label')].map((b) => b.innerText || b.textContent));
  const counted = [];
  for (const n of ['Entrance', 'Lobby', 'Room', 'Terrace', 'Overview']) counted.push(await page.getByRole('button', { name: n, exact: true }).count());
  check('phone: every stop button keeps its name for screen readers', counted.every((c) => c === 1), `${counted.join(',')} (${names.length} buttons)`);
});
await session(COMPUTER, async (page) => {
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    route.continue().catch(() => {});
  });
  await page.goto(`${base}/?above=0`);
  await page.waitForSelector('.ft__loading');
  const r = await page.evaluate(() => {
    const l = document.querySelector('.ft__loading');
    return { role: l.getAttribute('role'), pct: l.querySelector('.ft__loading-pct').getAttribute('aria-hidden') };
  });
  check('loading screen: a status, its percentage not read out', r.role === 'status' && r.pct === 'true', JSON.stringify(r));
});

// ---- reduced motion
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  const r = await page.evaluate(() => ({
    mode: window.__player.getAttribute('mode'),
    flag: window.__player.hasAttribute('stills'),
    stills: document.querySelectorAll('.ft__still img').length,
    cards: document.querySelectorAll('.ft__still > [data-stop][data-active]').length,
    alts: [...document.querySelectorAll('.ft__still img')].map((i) => i.alt).join(','),
    canvas: !!document.querySelector('canvas'),
  }));
  check('reduced motion: one still per stop with its card, no canvas', r.mode === null && r.flag && r.stills === 5 && r.cards === 5 && !r.canvas, JSON.stringify(r));
  await page.evaluate(() => window.__player.goToStop(3));
  await page.waitForTimeout(300);
  const at = await page.evaluate(() => Math.round(document.querySelector('[data-still="terrace"]').getBoundingClientRect().top));
  check("reduced motion: goToStop jumps to that stop's still", at === 0, `still top ${at}`);
  check('reduced motion: no page errors', errors.length === 0, errors.join(' | '));
});

// A moment in stills is a full screen over the still from the middle of its
// stretch, between the stops around it.
await session({ ...COMPUTER, reducedMotion: 'reduce' }, async (page, { errors }) => {
  await page.goto(`${base}/?above=0&moment=1`);
  await ready(page);
  const r = await page.evaluate(() => {
    const mo = document.querySelector('[data-moment]');
    const sec = mo.closest('.ft__still');
    const order = [...document.querySelector('.ft__stills').children].map((e) => e.dataset.still || (e.classList.contains('ft__still--moment') ? 'moment' : '?'));
    return {
      inScreen: !!sec && sec.classList.contains('ft__still--moment'),
      h: sec ? Math.round(sec.getBoundingClientRect().height) : 0,
      vh: innerHeight,
      img: sec?.querySelector('img')?.getAttribute('src') ?? '',
      alt: sec?.querySelector('img')?.alt,
      shown: getComputedStyle(mo).visibility,
      order: order.join(','),
    };
  });
  // The stairs run frames 162 to 240 (flight.json and file names count
  // from 1): the middle is frame 201.
  check('stills: a moment is a full screen over its middle still', r.inScreen && r.h === r.vh && r.img.endsWith('/0201.webp') && r.alt === '' && r.shown === 'visible', JSON.stringify(r));
  check('stills: the moment sits between the stops around it', r.order === 'entrance,lobby,moment,room,terrace,overview', r.order);
  check('stills with a moment: no page errors', errors.length === 0, errors.join(' | '));
});

// Before the player places them (here: stills whose manifest never answers),
// stops and moments stay hidden instead of showing as plain text.
await session(COMPUTER, async (page, { errors }) => {
  await page.route('**/never/manifest.json', () => {});
  await page.goto(`${base}/?above=0`);
  await ready(page);
  const r = await page.evaluate(() => {
    const el = document.createElement('fly-through');
    el.setAttribute('src', '/never/manifest.json');
    el.setAttribute('mode', 'stills');
    el.setAttribute('stops', '[{"id":"a","at":0.5}]');
    el.innerHTML = '<div data-stop="a">Card A</div><div data-moment data-from="0.1" data-to="0.2">Passing</div>';
    document.body.prepend(el);
    return [...el.querySelectorAll(':scope > [data-stop], :scope > [data-moment]')].map((c) => getComputedStyle(c).visibility).join(',');
  });
  check('stops and moments stay hidden until the player places them', r === 'hidden,hidden', r);
  check('unplaced: no page errors', errors.length === 0, errors.join(' | '));
});

// ---- names and colours
await session(COMPUTER, async (page, { errors }) => {
  await page.addInitScript(() => {
    document.addEventListener('flythrough-progress', (e) => (window.__progress = e.detail));
    document.addEventListener('flythrough-ready', () => (window.__veilClass = document.querySelector('.ft__loading')?.className));
  });
  await page.goto(`${base}/?above=0`);
  await ready(page);
  const s = await info(page);
  await page.evaluate((y) => window.scrollTo(0, y), s.stops[2] + 40);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    detail: window.__progress,
    frame: window.__player.frame,
    position: window.__player.position,
    booted: window.__player.hasAttribute('data-booted'),
    mode: window.__player.getAttribute('mode'),
    past: document.querySelectorAll('.ft__label--past').length,
    old: document.querySelectorAll('.is-past, .is-done').length,
    veil: window.__veilClass,
  }));
  check('progress event: carries the position in the track too, and the frame counted from 1', Math.abs(r.detail?.position - r.position) < 1e-9 && r.detail?.progress > 0 && r.detail?.frame === r.frame + 1, JSON.stringify(r.detail));
  check('names: no data-booted, mode left as written, ft__ state classes', !r.booted && r.mode === null && r.past >= 2 && r.old === 0 && /ft__loading--done/.test(r.veil ?? ''), JSON.stringify({ ...r, detail: undefined }));
  check('names: no page errors', errors.length === 0, errors.join(' | '));
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&light=1`);
  await ready(page);
  const c = await page.evaluate(() => [getComputedStyle(document.querySelector('.ft__label')).color, getComputedStyle(document.querySelector('.ft__line')).backgroundColor]);
  // rgba(17, 17, 17, 0.55) or color(srgb 0.067 0.067 0.067 / 0.55)
  const red = (v) => {
    const n = v.match(/[\d.]+/g).map(Number);
    return v.startsWith('color(') ? n[0] * 255 : n[0];
  };
  check('colours: a dark --ft-fg darkens the labels and the line', red(c[0]) < 60 && red(c[1]) < 60, c.join(' | '));
});

// ---- rotation and the address bar (phone)
if (which !== 'firefox') {
  await session(PHONE, async (page) => {
    await page.goto(`${base}/?above=0`);
    await ready(page);
    await page.waitForTimeout(800);
    let s = await info(page);
    await page.evaluate((y) => window.scrollTo(0, y), s.stops[2]);
    await page.waitForTimeout(800);
    const h0 = await page.evaluate(() => window.__player.querySelector('.ft__track').offsetHeight);
    // Address bar hiding: the visible height grows 60 px, the large viewport
    // (100lvh, where the player measures) stays: pinned here as on a phone.
    const pin = await page.addStyleTag({ content: '.ft__probe { height: 664px !important; }' });
    await page.setViewportSize({ width: 390, height: 664 + 60 });
    await page.waitForTimeout(600);
    const h1 = await page.evaluate(() => window.__player.querySelector('.ft__track').offsetHeight);
    const mid = await info(page);
    check('phone: the address bar showing or hiding leaves the track alone', h1 === h0 && mid.card === 'room', `track ${h0} -> ${h1}, card ${mid.card}`);
    await page.setViewportSize({ width: 390, height: 664 });
    await pin.evaluate((el) => el.remove());
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 844, height: 340 });
    await page.waitForTimeout(1200);
    s = await info(page);
    check('phone: rotating keeps the visitor at the same stop', Math.abs(s.y - s.stops[2]) <= 2 && s.card === 'room', `y ${s.y}, stop 3 at ${s.stops[2]}, card ${s.card}`);
  });
}
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  let s = await info(page);
  await page.evaluate((y) => window.scrollTo(0, y), s.stops[3]);
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(1200);
  s = await info(page);
  check('computer: resizing the window keeps the visitor at the same stop', Math.abs(s.y - s.stops[3]) <= 2 && s.card === 'terrace', `y ${s.y}, stop 4 at ${s.stops[3]}, card ${s.card}`);
});
// The track laid out again inside the player's size observer changed the
// page's height there, and whoever watches html or body in the same round
// (Lenis; the GSAP engine) was left undelivered until the next frame. The
// browser reports that ("ResizeObserver loop completed with undelivered
// notifications"): an error in Safari's console, a window error event in
// every browser (what an error tracker hears).
for (const lenis of [0, 1]) {
  await session(COMPUTER, async (page, { errors }) => {
    await page.addInitScript(() => {
      window.__loops = 0;
      addEventListener('error', (e) => /ResizeObserver/.test(e.message) && window.__loops++);
    });
    await page.goto(`${base}/?above=0&lenis=${lenis}`);
    await ready(page);
    const s = await info(page);
    await page.evaluate((y) => window.scrollTo(0, y), s.stops[3]);
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(1200);
    const mid = await info(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1200);
    const events = await page.evaluate(() => window.__loops);
    const thrown = errors.filter((e) => e.includes('ResizeObserver')).length;
    check(`resizing the window, ${lenis ? 'with' : 'without'} Lenis: no size-observer loop reported`, events === 0 && thrown === 0, `${events} error event(s), ${thrown} page error(s); after the first resize y ${mid.y}, stop 4 at ${mid.stops[3]}, card ${mid.card}`);
  });
}

// ---- loading screen hooks: the number, its sign, the fade length
// Every animation frame while the loading screen is up: the number shown,
// the real share of the ready set, and the whole percentage's text.
const sampleLoading = () => {
  const s = (window.__load = []);
  const tick = () => {
    const p = window.__player;
    const num = p?.querySelector('.ft__loading-num');
    if (num) s.push({ num: Number(num.textContent), real: p.readyShare, ready: p.ready, pct: p.querySelector('.ft__loading-pct').textContent, sign: p.querySelector('.ft__loading-sign')?.textContent });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
await session(COMPUTER, async (page) => {
  // Frames arrive in bursts of twelve, a fifth of a second apart.
  await page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, 200));
    route.continue().catch(() => {});
  });
  await page.addInitScript(sampleLoading);
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.waitForFunction(() => !document.querySelector('.ft__loading'), null, { timeout: 10000 });
  const s = await page.evaluate(() => window.__load);
  const nums = s.map((x) => x.num);
  const steps = nums.slice(1).map((n, i) => n - nums[i]);
  const realSteps = s.slice(1).map((x, i) => Math.round((x.real - s[i].real) * 100));
  check('loading: the "%" is its own element inside the percentage', s.length > 0 && s.every((x) => x.sign === '%' && /^\d+%$/.test(x.pct)), `${s.length} samples, e.g. "${s[Math.floor(s.length / 2)]?.pct}"`);
  check('loading: the number only ever counts up', steps.every((d) => d >= 0), `${new Set(nums).size} different numbers shown`);
  check('loading: the number is never ahead of what is loaded', s.every((x) => x.ready || x.num <= Math.floor(x.real * 100 + 1e-6)), '');
  // While loading; the last stretch to 100 as the screen lifts is its own run.
  const loadingSteps = steps.filter((_, i) => !s[i + 1].ready);
  const behind = s.filter((x) => !x.ready).at(-1);
  check('loading: it counts evenly while frames land in bursts', Math.max(...loadingSteps) < Math.max(...realSteps) && new Set(nums).size >= 30, `largest step shown ${Math.max(...loadingSteps)}, largest real jump ${Math.max(...realSteps)}; ${Math.round(behind.real * 100) - behind.num} behind as the screen lifts`);
  check('loading: the number reaches 100 before the screen is gone', nums.at(-1) === 100, `last shown ${nums.at(-1)}`);
});
for (const [name, qs, want] of [['default (450 ms)', '', 450], ['--ft-loading-fade: 1000ms', '&veil=1000', 1000]]) {
  await session(COMPUTER, async (page) => {
    await page.addInitScript(() => {
      document.addEventListener('flythrough-ready', () => {
        const t0 = performance.now();
        window.__fade = {};
        const tick = () => {
          if (window.__fade.gone === undefined && !document.querySelector('.ft__loading')) window.__fade.gone = performance.now() - t0;
          if (window.__fade.moved === undefined && scrollY > 2) window.__fade.moved = performance.now() - t0;
          if (window.__fade.gone === undefined || window.__fade.moved === undefined) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
    await page.goto(`${base}/?above=0&intro=1${qs}`);
    await ready(page);
    await page.waitForFunction(() => window.__fade?.gone !== undefined && window.__fade?.moved !== undefined, null, { timeout: 10000 });
    const f = await page.evaluate(() => window.__fade);
    check(`fade length ${name}: screen removed when the fade ends`, f.gone >= want && f.gone <= want + 250, `removed ${Math.round(f.gone)} ms after ready`);
    check(`fade length ${name}: the intro waits for the fade`, f.moved >= want + 60 && f.moved <= want + 450, `intro moving ${Math.round(f.moved)} ms after ready`);
  });
}

// ---- holdLoading: the loading screen kept up longer
// From when the screen appears: each animation frame's number, real share and
// lift state; when the ready set was all in (real), the lift (ready event) and
// the first move of the page (moved).
const sampleMin = () => {
  const s = (window.__min = { rows: [], wrote: [], t0: 0, real: 0, lift: 0, moved: 0 });
  const mo = new MutationObserver(() => {
    const num = document.querySelector('.ft__loading-num');
    if (!num) return;
    s.t0 = performance.now();
    mo.disconnect();
    // Each number at the moment the player writes it. The rows below are
    // read in this script's own animation frame, which runs before the
    // player's: they hold the number of the frame before.
    new MutationObserver(() => s.wrote.push({ t: performance.now() - s.t0, num: Number(num.textContent), ready: window.__player?.ready })).observe(num, { childList: true });
  });
  mo.observe(document, { childList: true, subtree: true });
  document.addEventListener('flythrough-ready', () => (s.lift = performance.now() - s.t0));
  const tick = () => {
    const p = window.__player;
    if (s.t0 && p) {
      const t = performance.now() - s.t0;
      if (!s.real && p.readyShare >= 1) s.real = t;
      if (!s.moved && scrollY > 2) s.moved = t;
      const num = p.querySelector('.ft__loading-num');
      if (num) s.rows.push({ t, num: Number(num.textContent), real: p.readyShare, ready: p.ready });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const slowFrames = (page, ms) =>
  page.route('**/tour/landscape/*.webp', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    route.continue().catch(() => {});
  });
const numbersOk = (m) => {
  const before = m.rows.filter((r) => !r.ready);
  const nums = m.rows.map((r) => r.num);
  const down = nums.findIndex((n, i) => i && n < nums[i - 1]);
  const ahead = before.find((r) => r.num > Math.floor(r.real * 100 + 1e-6));
  return {
    up: down < 0,
    behind: !ahead,
    why: [down >= 0 && `fell ${nums[down - 1]} -> ${nums[down]} at ${Math.round(m.rows[down].t)} ms`, ahead && `${ahead.num} shown with ${Math.round(ahead.real * 1000) / 10} in at ${Math.round(ahead.t)} ms`].filter(Boolean).join('; '),
    never100: before.every((r) => r.num < 100),
    last: nums.at(-1),
  };
};
await session(COMPUTER, async (page) => {
  await page.addInitScript(sampleMin);
  // The first visit fills the cache; the second is the fast load tested.
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.goto(`${base}/?above=0&loadingmin=2000`);
  await page.waitForFunction(() => window.__min?.real > 0, null, { timeout: 10000 });
  // Frames in, screen still up: a label tap does nothing, a wheel is held.
  const y0 = await page.evaluate(() => scrollY);
  await wheelAt(page, 600);
  await page.locator('.ft__label').nth(3).click();
  await page.waitForTimeout(250);
  const held = await page.evaluate(() => ({ y: scrollY, ready: window.__player.ready }));
  await ready(page);
  await page.waitForFunction(() => !document.querySelector('.ft__loading'), null, { timeout: 5000 });
  const m = await page.evaluate(() => window.__min);
  const n = numbersOk(m);
  check('holdLoading(2000), fast load: the frames are in well before it', m.real < 1700, `in at ${Math.round(m.real)} ms`);
  check('holdLoading(2000), fast load: the screen lifts at the minimum', m.lift >= 1990 && m.lift <= 2300, `lifted at ${Math.round(m.lift)} ms`);
  check('holdLoading: held up past the frames, page still and taps ignored', !held.ready && held.y === y0, `scrollY ${y0} -> ${held.y}, ready ${held.ready}`);
  // The number keeps to the clock: every number written in the second half
  // of the hold is judged against the time of its writing. Not against a
  // later reading: Playwright's headless Chromium draws this page only
  // every 33 to 117 ms while frames load, so a number read in the next
  // animation frame is 2 to 6 counts old (95 was read at 1.99 s) though it
  // was right when written (within 1 here, 2 with the processor slowed
  // four times). The number never runs ahead of the frames: were they in
  // late (a starved computer) it would follow them, not the clock, so the
  // row says when they were in.
  const late = m.wrote.filter((w) => !w.ready && w.t >= 1000);
  const off = (w) => Math.min(99, Math.floor(w.t / 20)) - w.num;
  const worst = late.reduce((a, w) => (Math.abs(off(w)) > Math.abs(off(a)) ? w : a), late[0]);
  const lastW = late.at(-1);
  check(
    'holdLoading: the number counts evenly to the minimum',
    !!lastW && late[0].t <= 1200 && lastW.t >= 1600 && Math.abs(off(worst)) <= 2,
    lastW
      ? `${late[0].num} written at ${Math.round(late[0].t)} ms; ${lastW.num} at ${Math.round(lastW.t)} ms, the last before the lift; furthest from the clock: ${worst.num} at ${Math.round(worst.t)} ms (the clock says ${worst.num + off(worst)}); frames in at ${Math.round(m.real)} ms`
      : `no number written after 1 s; frames in at ${Math.round(m.real)} ms`,
  );
  check('holdLoading: the number counts up, never ahead of the frames', n.up && n.behind, n.why);
  check('holdLoading: the number reaches 100 only as the screen lifts', n.never100 && n.last === 100, `last shown ${n.last}`);
});
await session(COMPUTER, async (page) => {
  await slowFrames(page, 250);
  await page.addInitScript(sampleMin);
  await page.goto(`${base}/?above=0&loadingmin=1000`);
  await ready(page);
  await page.waitForFunction(() => !document.querySelector('.ft__loading'), null, { timeout: 5000 });
  const m = await page.evaluate(() => window.__min);
  const n = numbersOk(m);
  // real is seen at the next animation frame, so it can trail the lift by a
  // long frame (46 ms seen once).
  check('holdLoading(1000), slow load: the screen lifts when the frames are in', m.real > 1200 && m.lift >= m.real - 80 && m.lift - m.real < 400, `in at ${Math.round(m.real)} ms, lifted at ${Math.round(m.lift)} ms`);
  check('holdLoading, slow load: the number follows the frames to 100', n.up && n.behind && n.never100 && n.last === 100, `last shown ${n.last} ${n.why}`);
});
await session(COMPUTER, async (page) => {
  await page.addInitScript(sampleMin);
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.goto(`${base}/?above=0`);
  await ready(page);
  const m = await page.evaluate(() => window.__min);
  check('no hold, fast load: the screen lifts as the frames are in', m.lift - m.real < 300, `in at ${Math.round(m.real)} ms, lifted at ${Math.round(m.lift)} ms`);
});
await session(COMPUTER, async (page) => {
  await page.addInitScript(sampleMin);
  await page.goto(`${base}/?above=0&intro=1&loadingmin=1500`);
  await ready(page);
  await page.waitForFunction(() => window.__min?.moved > 0, null, { timeout: 8000 }).catch(() => {});
  const m = await page.evaluate(() => window.__min);
  check('holdLoading(1500) with intro: the glide starts after the lift and fade', m.lift >= 1490 && m.moved >= m.lift + 450, `lifted at ${Math.round(m.lift)} ms, moving at ${Math.round(m.moved)} ms`);
});
await session(COMPUTER, async (page) => {
  await page.addInitScript(sampleMin);
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.goto(`${base}/?above=0&holdpromise=1`);
  await page.waitForFunction(() => window.__min?.real > 0, null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  const held = await page.evaluate(() => ({ ready: window.__player.ready, num: Number(window.__player.querySelector('.ft__loading-num')?.textContent) }));
  const t = await page.evaluate(() => (window.__release(), performance.now() - window.__min.t0));
  await ready(page, 'window.__player', 3000);
  await page.waitForFunction(() => !document.querySelector('.ft__loading'), null, { timeout: 5000 });
  const m = await page.evaluate(() => window.__min);
  check('holdLoading(promise): held past the frames, the number short of 100', !held.ready && held.num >= 90 && held.num < 100, `ready ${held.ready}, number ${held.num}`);
  check('holdLoading(promise): lifts as the promise settles', m.lift >= t && m.lift - t < 200, `released at ${Math.round(t)} ms, lifted at ${Math.round(m.lift)} ms`);
});
// A hold that outlasts the last frame by more than the 20 s of the stall
// rule (watchStall): the rule is for frames still expected, so with every
// frame in it says nothing, and the hold alone decides the lift. The
// promise settles 25 s after load.
await session(COMPUTER, async (page, { warnings }) => {
  await page.goto(`${base}/?above=0&holdpromise=1`, { waitUntil: 'load' });
  const t0 = Date.now();
  const allIn = await page.waitForFunction(() => window.__player?.hasAttribute('loaded'), null, { timeout: 15000 }).then(() => Date.now() - t0, () => -1);
  // 21 s after the last frame, so past the rule's 20 s.
  await page.waitForTimeout(21000);
  const held = await page.evaluate(() => ({ ready: window.__player.ready, veil: !!document.querySelector('.ft__loading'), stalled: window.__player.stalled }));
  const at = Date.now() - t0;
  await page.waitForTimeout(Math.max(0, 25000 - (Date.now() - t0)));
  const lifted = await page.evaluate(() => {
    const t = performance.now();
    const done = new Promise((r) => window.__player.addEventListener('flythrough-ready', () => r(Math.round(performance.now() - t)), { once: true }));
    window.__release();
    return Promise.race([done, new Promise((r) => setTimeout(() => r(-1), 3000))]);
  });
  const said = warnings.filter((w) => w.includes('frames stopped arriving'));
  check('a hold 20 s past the last frame: nothing said about frames', allIn >= 0 && said.length === 0 && !held.stalled, `every frame in after ${allIn} ms; ${said.length ? `said: ${said[0]}` : 'no warning'}; stalled ${held.stalled}`);
  check('a hold 20 s past the last frame: still up, lifts as it ends', !held.ready && held.veil && lifted >= 0 && lifted < 200, `at ${at} ms ready ${held.ready}, loading screen ${held.veil ? 'up' : 'gone'}; lifted ${lifted} ms after the promise settled`);
});

// ---- position: written before boot, and after
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0&intro=1&position=0.5`);
  await ready(page);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ y: Math.round(scrollY), want: Math.round(window.__player.yFor(0.5)), pos: window.__player.position }));
  check('position set before boot: opens there, no intro', Math.abs(r.y - r.want) <= 2 && Math.abs(r.pos - 0.5) < 0.001, `y ${r.y}, want ${r.want}`);
});
await session(COMPUTER, async (page) => {
  await page.goto(`${base}/?above=0`);
  await ready(page);
  await page.waitForTimeout(800);
  const s = await info(page);
  await countStopped(page);
  const target = await page.evaluate(() => {
    const p = window.__player;
    const sp = p.stopScroll[2] + 0.02;
    p.position = sp;
    return { y: Math.round(scrollY), want: Math.round(p.yFor(sp)) };
  });
  await page.waitForTimeout(2200);
  const late = await arrives(page, s.stops[2]);
  const end = await info(page);
  check('position set later: a cut there, then it comes to rest', Math.abs(target.y - target.want) <= 2 && Math.abs(end.y - s.stops[2]) <= 2 && end.card === 'room' && late.stopped === 0, `jumped to ${target.y} (want ${target.want}), rests at ${end.y}, stop 3 at ${s.stops[2]}${late.note}`);
});

// ---- hold without legs
{
  const heights = {};
  for (const hold of ['0', '0.6']) {
    await session(COMPUTER, async (page) => {
      await page.goto(`${base}/?above=0&nolegs=1&hold=${hold}`);
      await ready(page);
      heights[hold] = await page.evaluate(() => {
        const p = window.__player;
        return { h: p.querySelector('.ft__track').offsetHeight, vh: p.lvh(), last: p.stopScroll.at(-1), flightEnd: p.layout.knotsScroll.at(-2) };
      });
    });
  }
  const a = heights['0'];
  const b = heights['0.6'];
  check('hold without legs: the track grows by the hold', Math.abs(b.h - a.h - 0.6 * b.vh) <= 2, `${a.h} -> ${b.h} px (screen ${b.vh})`);
  check('hold without legs: the last stop sits at the end of the hold', b.last === 1 && b.flightEnd < 1, `last stop at ${b.last}, flight ends at ${b.flightEnd?.toFixed(3)}`);
}

await browser.close();
await server.close();
console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${which}${noGsap ? ', no GSAP' : ''}: ${rows.length - failed} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
