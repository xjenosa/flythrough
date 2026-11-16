// The framework examples, driven in a real browser. README.md's framework
// code is cut from these files (tools/snippets.mjs), so what the README
// shows is what ran here.
//
// examples/react, vue, svelte: Vite projects reading the package from this
// repo's source. Each way of using the player (the <Flythrough> component,
// the plain <fly-through> element) is a page, and each page runs twice:
// rendered on a server and taken over in the browser (a production server
// build renders it to HTML in Node, with no window), and as an empty page
// the browser fills (a plain Vite project).
//
// examples/next, examples/nuxt: real Next (app router) and Nuxt projects,
// with the package installed from `npm pack`, built and started as their
// own servers. They install their dependencies on first use (network).
// They run in Chromium; in another browser only when --only names one (what
// they add is the framework's own server and build, which no browser
// changes; taking a server's page over is run in every browser above).
//
// --packed: the Vite examples read the package as npm would publish it
// (packed and unpacked by test/packed.mjs: the built files, their private
// names shortened) instead of this repo's source. Next and Nuxt always do,
// so they are left out of that run.
//
// The checks use only what a site may use: the page, the element's
// attributes, events and documented methods. Nothing private: in the built
// files those names are not the source's.
//   node test/examples-test.mjs [--browser chromium|firefox|webkit]
//                               [--only react|vue|svelte|next|nuxt]
//                               [--packed]
import { chromium, firefox, webkit } from '../tools/tidy-browser.cjs';
import { build } from 'vite';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { execFileSync, execSync, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'production';
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const which = arg('--browser') ?? 'chromium';
const engine = { chromium, firefox, webkit }[which];
if (!engine) throw new Error(`unknown browser ${which}`);
const only = arg('--only');
const packed = process.argv.includes('--packed');
const { unpack, removePacked } = await import('./packed.mjs');
// Read by examples/from-source.mjs when each example's Vite config loads.
if (packed) process.env.FLYTHROUGH_PACKED = unpack();
if (!existsSync('demo/public/tour/manifest.json')) execSync('npm run demo:frames', { stdio: 'inherit' });

const rows = [];
const check = (name, ok, detail = '') => rows.push(`${ok ? 'ok  ' : 'FAIL'} ${(packed ? `packed, ${name}` : name).padEnd(72)} ${detail}`);
const browser = await engine.launch();
const debugging = !!process.env.EXAMPLES_DEBUG;

// ---- the checks every page gets
// o.name: what the rows are called. o.base: the page's address.
// o.served: the page arrived rendered by a server. o.scripts: its script
// files, to hold back. o.analytics: the page runs the analytics recipe.
// o.live: the page has a button that turns the bar off through a prop.
async function drive(o) {
  const tag = (s) => `${o.name}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  // The analytics recipe (examples/react/src/analytics.ts) sends to
  // Plausible's function; this stands in for Plausible and keeps what it got.
  await tab.addInitScript(() => {
    window.__sent = [];
    window.plausible = (event, options) => window.__sent.push([event, options?.props?.stop, options?.props?.nth]);
  });
  const problems = [];
  tab.on('pageerror', (e) => problems.push(String(e?.stack ?? e).slice(0, debugging ? 3000 : 200)));
  // Not Firefox's own note about pages that move with the scroll.
  tab.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && !m.text().includes('scroll-linked') && problems.push(m.text().slice(0, debugging ? 3000 : 200)));
  const status = () => tab.evaluate(() => document.querySelector('.tour-status')?.textContent?.trim());
  // The framework draws its state a moment after the event (longer in a
  // browser busy decoding frames).
  const statusIs = (text, timeout = 5000) => tab.waitForFunction((t) => document.querySelector('.tour-status')?.textContent?.trim() === t, text, { timeout }).then(() => true, () => false);
  // The page has stopped moving (1.2 s without a change, 20 s at most): a
  // glide runs long on a starved computer (see arrives in review-test.mjs),
  // and a place read while it is still under way is not where it ends.
  const still = () =>
    tab.evaluate(
      () =>
        new Promise((done) => {
          const t0 = performance.now();
          let y = scrollY;
          let at = t0;
          const look = () => {
            const now = performance.now();
            if (scrollY !== y) [y, at] = [scrollY, now];
            if (now - at >= 1200 || now - t0 > 20000) done();
            else setTimeout(look, 50);
          };
          look();
        }),
    );
  const players = () => tab.evaluate(() => [...document.querySelectorAll('fly-through')].map((p) => ({ ready: p.hasAttribute('ready'), labels: p.querySelectorAll('.ft__label').length, cards: p.querySelectorAll('.ft__overlays > [data-stop]').length })));
  // A player that has started has asked for its manifest: both players here
  // use the same one, so each request is one player starting.
  let manifests = 0;
  tab.on('request', (r) => new URL(r.url()).pathname === '/tour/manifest.json' && manifests++);
  // For the row that says why a run stopped: what was asked for and never
  // answered, and how many frames came.
  let frames = 0;
  const pending = new Set();
  tab.on('request', (r) => pending.add(new URL(r.url()).pathname));
  const got = [];
  const answered = (how) => async (r) => {
    const p = new URL(r.url()).pathname;
    pending.delete(p);
    if (/^\/tour\/.+\.(webp|avif|jpg)$/.test(p)) frames++;
    else got.push(`${p} ${how === 'failed' ? `failed (${r.failure()?.errorText})` : ((await r.response().catch(() => null))?.status() ?? 'no response')}`);
  };
  tab.on('requestfinished', answered('finished'));
  tab.on('requestfailed', answered('failed'));
  try {
    if (o.served) {
      // Before the script runs, the server's cards are in the page but
      // hidden (the stylesheet), so nothing flashes as plain text.
      await tab.route(o.scripts, async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        route.continue().catch(() => {});
      });
      await tab.goto(o.base + (o.debug ? '/?debug=1' : ''), { waitUntil: 'domcontentloaded' });
      const early = await tab.evaluate(() => {
        const card = document.querySelector('fly-through > [data-stop]');
        return card ? getComputedStyle(card).visibility : 'no card';
      });
      check(tag('before the script, the cards are in the page, hidden'), early === 'hidden', early);
    } else {
      await tab.goto(o.base + (o.debug ? '/?debug=1' : ''), { waitUntil: 'domcontentloaded' });
    }

    await tab.waitForFunction(() => document.querySelector('fly-through')?.hasAttribute('ready'), null, { timeout: 30000 });
    await tab.waitForTimeout(2300); // the intro glide
    await still();
    const first = await players();
    check(tag('the tour starts: five labels, five cards placed'), first[0].ready && first[0].labels === 5 && first[0].cards === 5, JSON.stringify(first[0]));
    check(tag('its events reach the framework (ready, then the stop showing)'), await statusIs('entrance'), `status "${await status()}"`);
    check(tag('the second player, far down, has not started: nothing asked for'), first.length === 2 && !first[1].ready && manifests === 1, `${manifests} manifest request(s), ${JSON.stringify(first[1])}`);
    check(tag(o.served ? 'taking the page over raises no error or warning' : 'no error or warning'), problems.length === 0, problems.join(' | '));

    // The debug overlay (flythrough/debug) reads the player's inside: from
    // the built files too, it shows the frame and the five stops' reach.
    if (o.debug) {
      const d = await tab.evaluate(() => ({ bands: document.querySelectorAll('fly-through [data-debug-stop]').length, text: document.querySelector('fly-through .ft__stage')?.textContent ?? '' }));
      check(tag('the debug overlay shows the frame, the stop and a band for each stop'), d.bands === 5 && /frame 49 of 720/.test(d.text) && /stop entrance/.test(d.text), `${d.bands} bands, "${d.text.match(/frame \d+ of \d+/)?.[0]}", "${d.text.match(/stop \w+/)?.[0]}"`);
    }

    // A label tap flies to the third stop; then a method through the
    // framework's reference to the element flies back to the first, where
    // the intro left the page.
    const first0 = await tab.evaluate(() => Math.round(scrollY));
    await tab.evaluate(() => document.querySelectorAll('fly-through .ft__label')[2].click());
    const mid = await statusIs('room', 20000);
    const far = await tab.evaluate(() => Math.round(scrollY));
    await tab.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Back to the first stop')).click());
    await tab.waitForTimeout(2400);
    await still();
    const back = await tab.evaluate(() => Math.round(scrollY));
    check(tag('a label tap flies to stop 3; goToStop through the reference flies back to the first stop'), mid && far > first0 + 500 && Math.abs(back - first0) <= 2 && (await statusIs('entrance')), `at stop 3 ${mid} (y ${far}), back at y ${back}, first stop at ${first0}, status "${await status()}"`);

    // Where the page goes from here on, for the remount's row below:
    // ms/scrollY/page height at each change.
    await tab.evaluate(() => {
      const t0 = performance.now();
      window.__trail = [];
      window.__trailer = setInterval(() => {
        const now = [Math.round(scrollY), document.documentElement.scrollHeight];
        const last = window.__trail.findLast((s) => s.length === 3);
        if (!last || last[1] !== now[0] || last[2] !== now[1]) window.__trail.push([Math.round(performance.now() - t0), ...now]);
      }, 50);
    });

    // A prop changed while the player runs is live.
    if (o.live) {
      const bars = async () => {
        await tab.evaluate(() => document.querySelector('button.bars').click());
        await tab.waitForTimeout(400);
        return tab.evaluate(() => ({ bar: !!document.querySelector('fly-through .ft__bar'), same: document.querySelector('fly-through') === (window.__first ??= document.querySelector('fly-through')), attr: document.querySelector('fly-through').getAttribute('bar') }));
      };
      await tab.evaluate(() => (window.__first = document.querySelector('fly-through')));
      const off = await bars();
      const on = await bars();
      check(tag('a prop changed while it runs is live: the bar goes and comes back, the same player'), !off.bar && off.attr === 'off' && on.bar && off.same && on.same, `off: ${JSON.stringify(off)}; on: ${JSON.stringify(on)}`);
    }

    // Other cards: a new player. The component is swapped where the visitor
    // is, at the first stop inside the tour: it takes the page to the new
    // tour's top itself. The element written directly is swapped from the
    // top of the page, as the README says to, so it too opens as on a fresh
    // visit.
    if (!o.live) {
      await tab.evaluate(() => (window.__trail.push(['to the top']), window.scrollTo(0, 0)));
      await tab.waitForTimeout(300);
    }
    await tab.evaluate(() => {
      window.__old = document.querySelector('fly-through');
      window.__trail.push(['switch']);
      document.querySelector('button.switch').click();
    });
    await tab.waitForFunction(() => {
      const p = document.querySelector('fly-through');
      return p !== window.__old && p.hasAttribute('ready');
    }, null, { timeout: 30000 }).catch(() => {});
    await tab.waitForTimeout(3500);
    const again = await tab.evaluate(() => {
      const p = document.querySelector('fly-through');
      return { fresh: p !== window.__old, oldGone: !window.__old.isConnected, ready: p.hasAttribute('ready'), labels: p.querySelectorAll('.ft__label').length, cards: p.querySelectorAll('.ft__overlays > [data-stop]').length };
    });
    check(tag('other cards: a new player with two stops, the old one gone'), again.fresh && again.oldGone && again.ready && again.labels === 2 && again.cards === 2, JSON.stringify(again));
    const trail = await tab.evaluate(() => (clearInterval(window.__trailer), window.__trail.map((s) => s.join('/')).join(' ')));
    const landed = await statusIs('entrance');
    check(tag('the new player reports its stop to the framework'), landed, `status "${await status()}"${landed ? '' : `; ms/scrollY/page height: ${trail}`}`);

    // The plain scrub further down: starts when near, no bar, its line
    // shows inside its stretch.
    await tab.evaluate(() => document.querySelectorAll('fly-through')[1].scrollIntoView());
    await tab.waitForFunction(() => document.querySelectorAll('fly-through')[1]?.hasAttribute('ready'), null, { timeout: 30000 }).catch(() => {});
    const scrub = await tab.evaluate(async () => {
      const p = document.querySelectorAll('fly-through')[1];
      const line = p.querySelector('[data-moment]');
      const before = line.hasAttribute('data-active');
      let frame = 0;
      p.addEventListener('flythrough-progress', (e) => (frame = e.detail.frame));
      // A quarter of the way through its track: the element is the track.
      const top = p.getBoundingClientRect().top + scrollY;
      window.scrollTo(0, top + 0.25 * (p.offsetHeight - innerHeight));
      await new Promise((r) => setTimeout(r, 400));
      return { ready: p.hasAttribute('ready'), bar: !!p.querySelector('.ft__bar'), before, during: line.hasAttribute('data-active'), frame };
    });
    check(tag('a plain scrub: no stops, no bar, its line passes by, the frame follows the scroll'), scrub.ready && !scrub.bar && !scrub.before && scrub.during && Math.abs(scrub.frame - 181) <= 2, JSON.stringify(scrub));
    // The analytics recipe ran through all of the above: every stop whose
    // card showed was reported once, in the order met, counted from 1, also
    // across the second tour (a new player) and not for the plain scrub.
    if (o.analytics) {
      const sent = await tab.evaluate(() => window.__sent);
      const stops = sent.map((s) => s[1]);
      const once = new Set(stops).size === stops.length;
      const counted = sent.every((s, i) => s[0] === 'Tour stop' && s[2] === i + 1);
      check(tag('analytics recipe: each stop reached is reported once, counted in order'), stops[0] === 'entrance' && stops.includes('room') && once && counted && stops.length >= 2 && stops.length <= 5, sent.map((s) => `${s[2]} ${s[1]}`).join(', '));
    }
    check(tag('no error or warning by the end'), problems.length === 0, problems.join(' | '));
  } catch (err) {
    // What the page looked like when it stopped: enough to tell a page that
    // never mounted from a player that never got its frames.
    const state = await tab
      .evaluate(() => ({
        players: [...document.querySelectorAll('fly-through')].map((p) => `${[...p.attributes].map((a) => a.name).filter((n) => !['src', 'stops'].includes(n)).join(' ')}; defined ${p.matches(':defined')}; ${p.offsetHeight} px tall at ${Math.round(p.getBoundingClientRect().top + scrollY)}`),
        defined: !!customElements.get('fly-through'),
        scrollY: Math.round(scrollY),
        app: document.getElementById('app')?.childElementCount,
      }))
      .catch((e) => String(e).slice(0, 200));
    check(tag('ran to the end'), false, `${String(err).slice(0, 300)}; page: ${JSON.stringify(state)}; ${manifests} manifest request(s), ${frames} frame(s) answered, ${pending.size} request(s) unanswered${pending.size ? ` (${[...pending].slice(0, 3).join(', ')})` : ''}; answered: ${got.join(', ') || 'nothing'}; problems: ${problems.join(' | ') || 'none'}`);
  }
  await ctx.close();
}

// The page of NoteApp (examples/react, examples/vue): a moment and the
// poster, each a direct child of the component, shown and hidden while the
// player runs. Each time the component builds a new player; nothing throws
// (React asked the element for a child the player had moved: a blank page).
// o.text: the page of TextApp (examples/react) instead: bare text before a
// card, shown and hidden the same way.
async function driveNote(o) {
  const tag = (s) => `${o.name}: ${s}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  const problems = [];
  tab.on('pageerror', (e) => problems.push(String(e?.stack ?? e).slice(0, debugging ? 3000 : 200)));
  tab.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && !m.text().includes('scroll-linked') && problems.push(m.text().slice(0, debugging ? 3000 : 200)));
  const state = () =>
    tab.evaluate(() => {
      const p = document.querySelector('fly-through');
      return {
        app: document.getElementById('app').childElementCount,
        players: document.querySelectorAll('fly-through').length,
        fresh: !!p && p !== window.__old,
        ready: !!p?.hasAttribute('ready'),
        cards: p?.querySelectorAll('.ft__overlays > [data-stop]').length ?? 0,
        moments: p?.querySelectorAll('.ft__overlays > [data-moment]').length ?? 0,
        // The poster is taken away once the first frame is drawn.
        stray: p?.querySelectorAll(':scope > [data-stop], :scope > [data-moment], :scope > [data-poster]').length ?? 0,
        // Bare text written directly inside the player.
        text: [...(p?.childNodes ?? [])].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join('|'),
      };
    });
  // Presses a button, then waits for the player that follows to be ready.
  const press = async (button) => {
    await tab.evaluate((b) => {
      window.__old = document.querySelector('fly-through');
      document.querySelector(`button.${b}`).click();
    }, button);
    await tab
      .waitForFunction(() => {
        const p = document.querySelector('fly-through');
        return p && p !== window.__old && p.hasAttribute('ready');
      }, null, { timeout: 30000 })
      .catch(() => {});
    await tab.waitForTimeout(600);
    return state();
  };
  try {
    await tab.goto(o.base, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => document.querySelector('fly-through')?.hasAttribute('ready'), null, { timeout: 30000 });
    const first = await state();
    if (o.text) {
      const shown = await press('text');
      check(tag('bare text shown before a card: a new player, the text in it'), shown.app > 0 && shown.players === 1 && shown.fresh && shown.ready && shown.cards === 2 && shown.stray === 0 && shown.text === 'Scroll to fly', JSON.stringify(shown));
      const hidden = await press('text');
      check(tag('the text hidden again: a new player without it'), hidden.app > 0 && hidden.players === 1 && hidden.fresh && hidden.ready && hidden.cards === 2 && hidden.stray === 0 && hidden.text === '', JSON.stringify(hidden));
      check(tag('the page it started with: two cards, no text'), first.ready && first.cards === 2 && first.text === '', JSON.stringify(first));
      check(tag('no error or warning'), problems.length === 0, problems.join(' | '));
      await ctx.close();
      return;
    }
    const shown = await press('note');
    check(tag('a moment shown between two cards: a new player, the moment in its stage'), shown.app > 0 && shown.players === 1 && shown.fresh && shown.ready && shown.cards === 2 && shown.moments === 1 && shown.stray === 0, JSON.stringify(shown));
    const hidden = await press('note');
    check(tag('the moment hidden again: a new player without it'), hidden.app > 0 && hidden.players === 1 && hidden.fresh && hidden.ready && hidden.cards === 2 && hidden.moments === 0 && hidden.stray === 0, JSON.stringify(hidden));
    const poster = await press('poster');
    const noPoster = await press('poster');
    check(tag('the poster added, then taken out: a new player each time'), poster.fresh && poster.ready && poster.cards === 2 && noPoster.fresh && noPoster.ready && noPoster.cards === 2 && noPoster.app > 0, `${JSON.stringify(poster)}; ${JSON.stringify(noPoster)}`);
    check(tag('the page it started with: two cards, no moment'), first.ready && first.cards === 2 && first.moments === 0, JSON.stringify(first));
    check(tag('no error or warning'), problems.length === 0, problems.join(' | '));
  } catch (err) {
    check(tag('ran to the end'), false, `${String(err).slice(0, 300)}; problems: ${problems.join(' | ') || 'none'}`);
  }
  await ctx.close();
}

// What a server's HTML must hold: the element with its src, the cards, the
// plain scrub's line, and the stops where this way of writing them puts them.
function checkHtml(name, html, way, error = '') {
  check(`${name}: renders on a server, the cards in the HTML`, !error && typeof window === 'undefined' && /<fly-through[^>]* src="\/tour\/manifest.json"/.test(html) && html.includes('Terrace') && html.includes('One long shot'), error);
  if (way === 'plain') check(`${name}: the stops are an attribute in the server HTML`, /stops="\[\{&quot;id&quot;:&quot;entrance&quot;/.test(html), html.match(/stops="[^"]{0,40}/)?.[0] ?? 'no stops attribute');
  else check(`${name}: each stop is on its card in the server HTML`, /data-stop="entrance"[^>]* data-at="0.0668"[^>]* data-label="Entrance"/.test(html) && !/<fly-through[^>]* stops=/.test(html), html.match(/<h2[^>]*data-stop="entrance"[^>]*>/)?.[0] ?? 'no card');
}

// ---- the Vite examples, the package from source
const VITE = [
  // 'note': the page of NoteApp, filled by the browser only (driveNote).
  // 'text': the page of TextApp, the same way.
  { name: 'react', entry: 'src/entry-server.tsx', ways: ['component', 'plain', 'note', 'text'] },
  { name: 'vue', entry: 'src/entry-server.ts', ways: ['component', 'plain', 'note'] },
  // Svelte filled by the browser is also the check on define() in
  // src/flythrough.ts: Svelte copies the elements out of a template before
  // the player loads, which WebKit never upgrades by itself. (The test host
  // cannot show it: Vite's dev client uses customElements first.)
  { name: 'svelte', entry: 'src/entry-server.ts', ways: ['plain'] },
].filter((e) => !only || e.name === only);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' };

// The built page (the server's HTML in it or not), the build's files, and
// the demo frames under /tour/.
function serve(dist, page) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    const file = url === '/' ? null : url.startsWith('/tour/') ? path.join('demo/public', url) : path.join(dist, url);
    if (file && (!existsSync(file) || !statSync(file).isFile())) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[file ? path.extname(file) : '.html'] ?? 'application/octet-stream' });
    if (file) createReadStream(file).pipe(res);
    else res.end(page);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

for (const { name, entry, ways } of VITE) {
  const root = path.resolve('examples', name);
  const configFile = path.join(root, 'vite.config.mjs');
  const dist = path.join(root, 'dist');
  // Built as a project would build it: for the browser, and for a server.
  await build({ root, configFile, logLevel: 'error', build: { outDir: 'dist', emptyOutDir: true, minify: !debugging } });
  await build({ root, configFile, logLevel: 'error', build: { ssr: entry, outDir: 'dist/server', emptyOutDir: true, minify: false } });
  const { render } = await import(pathToFileURL(path.join(dist, 'server/entry-server.js')).href);
  const shell = readFileSync(path.join(dist, 'index.html'), 'utf8');
  // Which player the example was built with: the source's private names
  // are in a build from source and nowhere in one from the packed files.
  if (packed) {
    const scripts = readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(dist, 'assets', f), 'utf8')).join('');
    check(`${name}: built with the packed package's files`, scripts.includes('flythrough-ready') && !scripts.includes('placeAtResize') && !scripts.includes('stopList'));
  }

  for (const way of ways) {
    if (way === 'note' || way === 'text') {
      const page = shell.replace('<div id="app"><!--app--></div>', () => `<script>window.__way = ${JSON.stringify(way)};</script><div id="app"></div>`);
      const server = await serve(dist, page);
      await driveNote({ name: `${name}, the component, ${way === 'text' ? 'bare text' : 'a child'} that comes and goes`, base: `http://127.0.0.1:${server.address().port}`, text: way === 'text' });
      await new Promise((done) => server.close(done));
      continue;
    }
    for (const served of [true, false]) {
      const run = `${name}${ways.length > 1 ? `, ${way === 'plain' ? 'the plain element' : 'the component'}` : ''}, ${served ? 'server-rendered' : 'filled by the browser'}`;
      let html = '';
      if (served) {
        let error = '';
        try {
          html = await render(way);
        } catch (err) {
          error = String(err?.stack ?? err).slice(0, 400);
        }
        checkHtml(run, html, way, error);
        if (error) continue;
      }
      // main.* reads which page it is from window.__way.
      const page = shell.replace('<div id="app"><!--app--></div>', () => `<script>window.__way = ${JSON.stringify(way)};</script><div id="app">${html}</div>`);
      const server = await serve(dist, page);
      await drive({ name: run, base: `http://127.0.0.1:${server.address().port}`, served, scripts: '**/assets/*.js', analytics: name === 'react', live: way === 'component', debug: name === 'react' && way === 'component' && !served });
      await new Promise((done) => server.close(done));
    }
  }
}

// ---- Next and Nuxt: real projects, the package as npm would install it
const FRAMEWORKS = [
  {
    name: 'next',
    title: 'Next (app router)',
    build: ['node', 'node_modules/next/dist/bin/next', 'build'],
    built: ['.next'],
    start: (port) => ['node', ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {}],
    scripts: '**/_next/static/**/*.js',
    analytics: false,
  },
  {
    name: 'nuxt',
    title: 'Nuxt',
    build: ['node', 'node_modules/nuxt/bin/nuxt.mjs', 'build'],
    built: ['.nuxt', '.output'],
    start: (port) => ['node', ['.output/server/index.mjs'], { PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' }],
    scripts: '**/_nuxt/*.js',
    analytics: false,
  },
].filter((f) => !packed && (only ? f.name === only : which === 'chromium'));

const freePort = () =>
  new Promise((done) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
const quiet = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NUXT_TELEMETRY_DISABLED: '1' } };
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, ...quiet });
// npm is a script on Windows, so it goes through the shell, as one line.
const npm = (line, cwd) => execSync(`npm ${line}`, { cwd, ...quiet });

let tarball = '';
for (const fw of FRAMEWORKS) {
  const dir = path.resolve('examples', fw.name);
  const tag = (s) => `${fw.title}: ${s}`;
  let child;
  try {
    // The package as it would be published: packed (which builds dist/),
    // then installed in the project next to the framework.
    if (!tarball) {
      const out = npm('pack --pack-destination examples --silent', path.resolve('.')).trim().split('\n').pop().trim();
      tarball = path.resolve('examples', out);
    }
    if (!existsSync(path.join(dir, 'node_modules'))) npm('install --no-audit --no-fund', dir);
    npm(`install --no-save --no-audit --no-fund "${tarball}"`, dir);
    // The demo frames, as the project's own public/tour.
    mkdirSync(path.join(dir, 'public'), { recursive: true });
    if (!existsSync(path.join(dir, 'public/tour'))) symlinkSync(path.resolve('demo/public/tour'), path.join(dir, 'public/tour'), 'junction');
    sh(fw.build[0], fw.build.slice(1), dir);

    const port = await freePort();
    const [cmd, args, env] = fw.start(port);
    child = spawn(cmd, args, { cwd: dir, env: { ...process.env, ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    let html = '';
    for (let i = 0; i < 80 && !html; i++) {
      await new Promise((r) => setTimeout(r, 250));
      html = await fetch(base).then((r) => (r.ok ? r.text() : ''), () => '');
    }
    if (!html) throw new Error('the server did not answer');
    checkHtml(fw.title, html, 'component');
    await drive({ name: fw.title, base, served: true, scripts: fw.scripts, analytics: fw.analytics, live: true });
  } catch (err) {
    check(tag('installed, built and started'), false, String(err?.stderr || err?.stdout || err).slice(-600).replace(/\s+/g, ' '));
  }
  if (child) {
    const gone = new Promise((done) => child.once('exit', done));
    child.kill();
    await gone;
  }
  // What the build wrote is made again on every run: not kept. The
  // project's node_modules stay, so the next run needs no network.
  for (const out of fw.built) rmSync(path.join(dir, out), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
if (tarball) rmSync(tarball, { force: true });
if (packed) removePacked();
await browser.close();

console.log(rows.join('\n'));
const failed = rows.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${which}: ${rows.length - failed} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
