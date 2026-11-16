// Host page for test/host-test.mjs (never shipped): the demo footage with
// letramy.com's tour settings (five stops, its legs and window), and host
// content above and below. Query: lenis=0|1, intro=0|1, return=on|off (omit
// for the default), snap=off, autoscroll=auto|off, above=0 (no content
// above), aboveh=<vh> (how tall the content above is, default 150),
// mode=scrub|stills, below=0 (no content below), two=1 (a second player
// further down),
// glide=scaled, veil=<ms> (--ft-loading-fade), loadingmin=<ms> (holdLoading),
// cards=1 (the stops written on their cards, no stops attribute), bar=off,
// holdpromise=1 (holdLoading(promise), released by window.__release()),
// position=<0..1> (set before boot), nolegs=1 (no legs: paced by length),
// hold=<screens>, moment=1 (a moment over the demo's stairs stretch),
// progress=1 (a box marked data-progress in the first card, a dot in it
// moved by --ft-progress),
// stage=<vh> or stagepx=<px> (a player in a box: --ft-stage-height),
// stagew=<px> (the box's width, centred),
// plain=1 (a plain scrub: no stops, no cards, no legs),
// by=frame|time (the stops and the moment placed by frame number or by
// seconds instead of 0 to 1), debug=1 (the debug overlay, flythrough/debug),
// src=<manifest url>, label=<first stop's label>, box=1 (the page scrolls
// inside a box instead of the window), wrap=hidden|clip (the player inside a
// wrapper with that overflow-x), light=1 (--ft-fg dark on a light --ft-bg),
// margin=<px> (a margin on body, as a page without a reset has),
// snap, return, bar and autoscroll take any value (off, false).
// Each card holds a link, for the keyboard checks.
// gsap=0, or a test run with --no-gsap: the entry without GSAP,
// "flythrough/no-gsap". GSAP is then not loaded at all, and Lenis, which
// does the gliding there, is on unless lenis=0 says no.
//
// The page has two scripts, one for each entry, each importing its entry at
// the top as a site does: main.ts (flythrough, with GSAP) and
// main-no-gsap.ts. Both run this file's run(). test/host/serve.mjs puts the
// right one in index.html.
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import '../../src/flythrough.css';
import type { Flythrough } from '../../src/flythrough.js';
import flight from '../../demo/footage/flight.json';

type Gsap = { gsap: typeof import('gsap').default; ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger };

// g: GSAP, from the script of the entry that uses it; null without it.
export function run(g: Gsap | null) {
const q = new URLSearchParams(location.search);
const noGsap = !g;
if (q.get('above') === '0') document.getElementById('above')!.remove();
if (q.get('aboveh')) document.getElementById('above')!.style.minHeight = `${q.get('aboveh')}vh`;
if (q.get('below') === '0') document.getElementById('below')!.remove();
if (q.get('margin')) document.body.style.margin = `${q.get('margin')}px`;
if (q.get('box') === '1') {
  document.documentElement.style.cssText = 'height: 100%; overflow: hidden';
  document.body.style.cssText = 'height: 100%; overflow: auto';
}

const at = (frame: number) => Number(((frame - 1) / (flight.frames - 1)).toFixed(4));
// The demo footage plays 24 frames a second.
const secs = (frame: number) => (frame - 1) / 24;
const by = q.get('by');
const place = by === 'frame' ? (frame: number) => frame : by === 'time' ? secs : at;
const stops = flight.stops.map((s) => ({
  id: s.id,
  [by === 'frame' || by === 'time' ? by : 'at']: place(s.frame),
  focus: s.focus,
  label: s.id === flight.stops[0].id && q.get('label') ? q.get('label')! : s.id[0].toUpperCase() + s.id.slice(1),
  ...('from' in s ? { from: place(s.from as number) } : {}),
}));
const screens = flight.pace.legs.reduce((a, b) => a + b, 0) + flight.pace.hold;

function makePlayer(): Flythrough {
  const el = document.createElement('fly-through') as Flythrough;
  el.setAttribute('src', q.get('src') || '/tour/manifest.json');
  // Stops as JSON, or (cards=1) each on its card below.
  const onCards = q.get('cards') === '1';
  if (!onCards) el.setAttribute('stops', JSON.stringify(stops));
  if (q.get('bar')) el.setAttribute('bar', q.get('bar')!);
  el.setAttribute('length', '8');
  el.setAttribute('legs', JSON.stringify(flight.pace.legs));
  el.setAttribute('hold', String(flight.pace.hold));
  // A card shows within 0.38 screen heights either side of its stop.
  el.setAttribute('reach', '0.38');
  el.setAttribute('loading-text', 'Preparing the tour');
  el.setAttribute('bar-label', 'Tour progress');
  if (q.get('intro') === '1') el.setAttribute('intro', '');
  // intro=false: the attribute there, saying no (what Vue leaves behind).
  if (q.get('intro') === 'false') el.setAttribute('intro', 'false');
  // legs=plain: the legs as a plain list, not JSON.
  if (q.get('legs') === 'plain') el.setAttribute('legs', flight.pace.legs.join(' '));
  if (q.get('return')) el.setAttribute('return-to-first', q.get('return')!);
  if (q.get('snap')) el.setAttribute('snap', q.get('snap')!);
  if (q.get('glide')) el.setAttribute('glide', q.get('glide')!);
  if (q.get('veil')) el.style.setProperty('--ft-loading-fade', `${q.get('veil')}ms`);
  if (q.get('loadingmin')) el.holdLoading(Number(q.get('loadingmin')));
  if (q.get('holdpromise') === '1') el.holdLoading(new Promise((r) => ((window as any).__release = r)));
  if (q.get('position')) el.position = Number(q.get('position'));
  if (q.get('nolegs') === '1') el.removeAttribute('legs');
  if (q.get('hold')) el.setAttribute('hold', q.get('hold')!);
  if (q.get('autoscroll')) el.setAttribute('autoscroll', q.get('autoscroll')!);
  if (q.get('mode')) el.setAttribute('mode', q.get('mode')!);
  if (q.get('stage')) el.style.setProperty('--ft-stage-height', `${q.get('stage')}vh`);
  if (q.get('stagepx')) el.style.setProperty('--ft-stage-height', `${q.get('stagepx')}px`);
  if (q.get('stagew')) el.style.cssText += `;max-width:${q.get('stagew')}px;margin-inline:auto`;
  if (q.get('light') === '1') el.style.cssText += '--ft-fg: #111; --ft-bg: #f4f4f4';
  for (const s of stops) {
    const ov = document.createElement('div');
    ov.dataset.stop = s.id;
    if (onCards) {
      const given = s as Record<string, unknown>;
      for (const k of ['at', 'frame', 'time', 'from', 'label']) if (given[k] !== undefined) ov.dataset[k] = String(given[k]);
      if (s.focus) ov.dataset.focus = s.focus.join(' ');
    }
    ov.className = 'ov';
    ov.textContent = `Card: ${s.label} `;
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.textContent = `More about ${s.label}`;
    ov.append(a);
    if (q.get('progress') === '1' && s === stops[0]) {
      const box = document.createElement('span');
      box.setAttribute('data-progress', '');
      const dot = document.createElement('i');
      dot.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;transform:translateX(calc(var(--ft-progress, 0) * 1000px))';
      box.append(dot);
      ov.append(box);
    }
    el.append(ov);
  }
  if (q.get('moment') === '1') {
    const m = flight.moments[0];
    const mo = document.createElement('div');
    mo.dataset.moment = m.id;
    const key = by === 'frame' ? 'Frame' : by === 'time' ? 'Time' : '';
    mo.dataset[`from${key}`] = String(place(m.from));
    mo.dataset[`to${key}`] = String(place(m.to));
    mo.textContent = 'Passing the stairs';
    el.append(mo);
  }
  if (q.get('plain') === '1') {
    el.removeAttribute('stops');
    el.removeAttribute('legs');
    el.replaceChildren();
  }
  return el;
}

const el = makePlayer();
if (q.get('wrap')) {
  const wrap = document.createElement('div');
  wrap.style.overflowX = q.get('wrap')!;
  wrap.append(el);
  document.getElementById('slot')!.replaceWith(wrap);
} else document.getElementById('slot')!.replaceWith(el);
let second: Flythrough | null = null;
if (q.get('two') === '1') {
  second = makePlayer();
  document.getElementById('slot2')!.replaceWith(second);
} else {
  document.getElementById('below2')!.remove();
}

if (q.get('lenis') === '1' || (noGsap && q.get('lenis') !== '0')) {
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false });
  if (g) {
    lenis.on('scroll', g.ScrollTrigger.update);
    g.gsap.ticker.add((t) => lenis.raf(t * 1000));
    g.gsap.ticker.lagSmoothing(0);
  } else {
    // Without GSAP's ticker: Lenis's frames from the page's own.
    const frame = (t: number) => {
      lenis.raf(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  el.useLenis(lenis);
  second?.useLenis(lenis);
  (window as any).__lenis = lenis;
}
if (q.get('debug') === '1') {
  void import('../../src/debug.js').then(({ debug }) => ((window as any).__undebug = debug(el)));
}
(window as any).__player = el;
(window as any).__second = second;
(window as any).__makePlayer = makePlayer;
(window as any).__ST = g?.ScrollTrigger;
(window as any).__noGsap = noGsap;
}
