// Demo page script. Stops, moments and pacing come from footage/flight.json
// (the same file the frame maker read for its portrait crop), so frames and
// page cannot drift apart. The player is imported only after its attributes
// are set: defining <fly-through> boots every one already on the page. Lenis
// runs on computers only, as on letramy.com. Every stylesheet comes through
// style.css, linked from index.html, so it is in before the first paint
// (imported here, the dev server would paint the page unstyled first).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { Flythrough } from '../src/index.js';
import flight from './footage/flight.json';

// Bar labels are section names, one short word each (owner).
const LABELS: Record<string, string> = {
  entrance: 'Intro',
  lobby: 'Stops',
  room: 'Glide',
  terrace: 'Phones',
  overview: 'Setup',
};

// flight.json counts frames as the files do (0049.webp is frame 49), and the
// player takes a stop's place and a moment's stretch as frame numbers.
const stops = flight.stops.map((s) => ({
  id: s.id,
  frame: s.frame,
  focus: s.focus,
  label: LABELS[s.id] ?? s.id,
  ...('from' in s ? { from: s.from as number } : {}),
}));
const screens = flight.pace.legs.reduce((a, b) => a + b, 0) + flight.pace.hold;

const player = document.getElementById('tour') as Flythrough;
player.setAttribute('stops', JSON.stringify(stops));
player.setAttribute('legs', JSON.stringify(flight.pace.legs));
player.setAttribute('hold', String(flight.pace.hold));
// A card shows within about 0.38 screen heights either side of its stop.
player.setAttribute('reach', '0.38');
for (const m of flight.moments) {
  const el = player.querySelector<HTMLElement>(`[data-moment="${m.id}"]`);
  if (!el) continue;
  el.dataset.fromFrame = String(m.from);
  el.dataset.toFrame = String(m.to);
}

// For trying settings by hand: ?glide=scaled, ?loadingmin=<ms>, ?lenis=0|1,
// ?mode=stills (also what the reduced-motion moment's link opens),
// ?mode=scrub (the flight whatever the device asks for), ?debug=1 (the
// layout overlay, flythrough/debug: its own file, loaded only then).
const q = new URLSearchParams(location.search);
if (q.get('debug') === '1') void import('../src/debug.js').then((m) => m.debug(player));
if (q.get('glide')) player.setAttribute('glide', q.get('glide')!);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// A data saver or a 2G connection: the player shows stills by itself
// (pickMode in src/math.ts; the same test).
const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
const saver = conn?.saveData === true || /2g/.test(conn?.effectiveType ?? '');
const forcedStills = q.get('mode') === 'stills';
const forcedMotion = q.get('mode') === 'scrub';
if (forcedStills || forcedMotion) player.setAttribute('mode', q.get('mode')!);
const stillsMode = forcedStills || ((reduced || saver) && !forcedMotion);

// The way to stills and back. In stills chosen by the link, a button that
// stays on screen leads back to the moving page (the owner: nobody thinks to
// press the link again or to edit the address); the moment's link goes, so
// the way back is not shown twice. A device that asks for less motion gets
// stills without either. One saving data gets stills with the button: the
// flight is then the visitor's own choice (?mode=scrub).
const stillsLink = player.querySelector<HTMLAnchorElement>('[data-stills-link]');
const back = document.querySelector<HTMLAnchorElement>('[data-motion-link]');
const motionUrl = (() => {
  const u = new URL(location.href);
  if (saver && !reduced) u.searchParams.set('mode', 'scrub');
  else u.searchParams.delete('mode');
  u.hash = '';
  return u.pathname + u.search;
})();
if (forcedStills || (stillsMode && !reduced)) {
  stillsLink?.remove();
  if (back) {
    back.href = motionUrl;
    back.hidden = false;
  }
} else if (stillsMode) {
  stillsLink?.remove();
} else if (stillsLink) {
  const u = new URL(location.href);
  u.searchParams.set('mode', 'stills');
  u.hash = '';
  stillsLink.href = u.pathname + u.search;
}

// The opening headline arrives letter by letter and its line word by word
// (animejs.com's intro). Each piece gets --d, its delay: 25ms apart on
// Anime.js's eased stagger (out-in quad over the whole run, so the middle
// pieces land closer together). Screen readers get the sentence whole from a
// hidden copy. Runs before the player boots, so the first entrance already
// has the pieces.
const outIn2 = (t: number) => (t < 0.5 ? (1 - (1 - 2 * t) ** 2) / 2 : ((2 * t - 1) ** 2 + 1) / 2);
function split(el: HTMLElement, by: 'letters' | 'words') {
  const texts: string[] = [];
  const out = document.createElement('span');
  out.setAttribute('aria-hidden', 'true');
  const pieces: HTMLElement[] = [];
  for (const node of [...el.childNodes]) {
    if (node.nodeName === 'BR') {
      out.append(document.createElement('br'));
      continue;
    }
    const text = node.textContent ?? '';
    texts.push(text);
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out.append(' ');
        continue;
      }
      const word = document.createElement('span');
      if (by === 'words') {
        word.className = 'wd';
        word.textContent = part;
        pieces.push(word);
      } else {
        word.className = 'wrd';
        for (const ch of part) {
          const c = document.createElement('span');
          c.className = 'ch';
          c.textContent = ch;
          word.append(c);
          pieces.push(c);
        }
      }
      out.append(word);
    }
  }
  const n = pieces.length;
  pieces.forEach((p, i) => p.style.setProperty('--d', `${Math.round(25 * (n - 1) * outIn2(n > 1 ? i / (n - 1) : 0))}ms`));
  const whole = document.createElement('span');
  whole.className = 'sr';
  whole.textContent = texts.join(' ').replace(/\s+/g, ' ').trim();
  el.replaceChildren(whole, out);
}
for (const el of document.querySelectorAll<HTMLElement>('[data-split]')) {
  split(el, el.dataset.split === 'words' ? 'words' : 'letters');
}

// Copy buttons get their icon here: a copy glyph and a tick that draws
// itself (pathLength 1, so style.css animates the dash from 1 to 0 to -1).
// Tabler Icons' copy and check, the family index.html credits.
const COPY_ICON =
  '<svg class="copy__glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9.667a2.667 2.667 0 0 1 2.667-2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1-2.667 2.667h-8.666a2.667 2.667 0 0 1-2.667-2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1-1.012-1.737v-10c0-1.1 .9-2 2-2h10c.75 0 1.158 .385 1.5 1"/></svg>' +
  '<svg class="copy__tick" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M5 12l5 5l10-10"/></svg>';
for (const btn of document.querySelectorAll<HTMLButtonElement>('.copy')) btn.innerHTML = COPY_ICON;

// The frame counter moment: the total from flight.json, and the frame on
// screen while it shows. Until then, and in stills, the middle of its
// stretch: the frame the player gives a moment's still. Frames are numbered
// from 1 here, as in flight.json; the player's event counts from 0.
const pad = (n: number) => String(n).padStart(4, '0');
const counter = player.querySelector<HTMLElement>('[data-moment="frames"]');
const counterNow = counter?.querySelector<HTMLElement>('.frames__now');
for (const el of document.querySelectorAll<HTMLElement>('[data-total="frames-padded"]')) el.textContent = pad(flight.frames);
const counterMoment = flight.moments.find((m) => m.id === 'frames');
if (counterNow && counterMoment) counterNow.textContent = pad(Math.round((counterMoment.from + counterMoment.to) / 2));
if (counter && counterNow) {
  let shown = -1;
  player.addEventListener('flythrough-progress', (e) => {
    if (!counter.hasAttribute('data-active')) return;
    const f = (e as CustomEvent<{ frame: number }>).detail.frame;
    if (f === shown) return;
    shown = f;
    counterNow.textContent = pad(f);
  });
}

await import('../src/index.js');

// The loading screen stays up at least 1.2 s on the first view of a browser
// session, so the count is seen rather than flashed; none on later views.
// The flag is written once the screen has lifted, so leaving mid-load still
// gets the minimum next time. Storage can throw (private windows, blocked
// site data): then every view gets the minimum. Called straight after the
// import, long before the frames can be in.
const SEEN_KEY = 'flythrough-demo-seen';
let seen = false;
try {
  seen = sessionStorage.getItem(SEEN_KEY) === '1';
} catch {}
const loadingMin = Number(q.get('loadingmin') ?? (seen ? 0 : 1200));
if (loadingMin > 0) player.holdLoading(loadingMin);
player.addEventListener(
  'flythrough-ready',
  () => {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {}
  },
  { once: true },
);

gsap.registerPlugin(ScrollTrigger);
const fine = matchMedia('(pointer: fine)').matches;
let lenis: Lenis | undefined;
if (q.get('lenis') !== '0' && (fine || q.get('lenis') === '1') && !stillsMode) {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  player.useLenis(lenis);
}

// Going down and coming back up animate differently, as on animejs.com.
// Each stop's point in the track (0 to 1): the legs up to it over all legs
// plus hold, as src/math.ts createLayout places stops.
const stopAt = flight.pace.legs.map((_, i, a) => a.slice(0, i + 1).reduce((s, x) => s + x, 0) / screens);
const stopEls = flight.stops.map((s) => player.querySelector<HTMLElement>(`[data-stop="${s.id}"]`));
const hero = player.querySelector<HTMLElement>('.stop--hero');
const nav = document.querySelector<HTMLElement>('.nav');

// Stills: every stop shows at once, in the flow; no cascade.
if (stillsMode) hero?.classList.remove('cascade');

// data-passed: the visitor is past this stop, so meets it next going up.
// flythrough-stop fires straight after data-active changes, before the
// browser restyles, so CSS takes the transition for this direction.
// player.position is a stored number; reading scrollY or a box here would
// restyle first, with the old value.
player.addEventListener('flythrough-stop', (e) => {
  const { id, active } = (e as CustomEvent<{ id: string; active: boolean }>).detail;
  const k = flight.stops.findIndex((s) => s.id === id);
  if (k < 0) return;
  const passed = (player.position ?? 0) > stopAt[k];
  stopEls[k]?.toggleAttribute('data-passed', passed);
  // The cascade is a first arrival from above. Once left, or if first met
  // from below, the opening screen is page content (style.css).
  if (k === 0 && (!active || passed)) hero?.classList.remove('cascade');
});

// --past: screen heights past the opening stop, 0 above it (so the top bar
// and headline stay in place there, decision 0014), capped at 1. Inactive
// stops get data-passed here too, for a jump that skips a stop's whole reach
// (the End key without Lenis, a position set from code).
let past = -1;
player.addEventListener('flythrough-progress', (e) => {
  const { position: scroll } = (e as CustomEvent<{ position: number }>).detail;
  stopEls.forEach((el, k) => {
    if (el && !el.hasAttribute('data-active')) el.toggleAttribute('data-passed', scroll > stopAt[k]);
  });
  const p = Math.min(1, Math.max(0, Math.round((scroll * screens - flight.pace.legs[0]) * 1000) / 1000));
  if (p === past) return;
  past = p;
  for (const el of [hero, nav]) el?.style.setProperty('--past', String(p));
  nav?.toggleAttribute('data-gone', p > 0.12);
  hero?.toggleAttribute('data-gone', p > 0.85);
});

// "Take the tour" flies to the first stop after the opening one; the top
// bar's "Get started" to the last stop, where the page ends. Both by the
// player's own glide (Lenis or GSAP, as every glide).
document.querySelector('[data-tour]')?.addEventListener('click', () => player.goToStop(1));
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-go="last"]')) {
  a.addEventListener('click', (e) => {
    if (player.hasAttribute('error')) return;
    e.preventDefault();
    player.goToStop(stops.length - 1);
  });
}

// Phones: the top bar's links behind its menu button (animejs.com's). A
// modal dialog, so focus stays inside and Escape closes it. A tap outside
// the panel, a link (Get started above glides too), the page moving (the top
// bar moves with it; a swipe on the dimmed page still scrolls it on iOS) or
// the window growing past the phone layout closes it, sliding out
// (style.css) unless motion is reduced.
const menu = document.querySelector<HTMLDialogElement>('#menu');
const menuButton = document.querySelector<HTMLButtonElement>('.nav__menu');
if (menu && menuButton) {
  let closing = 0;
  let openedAt = 0;
  const closeMenu = () => {
    if (!menu.open || closing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      menu.close();
      return;
    }
    menu.dataset.closing = '';
    closing = window.setTimeout(() => {
      closing = 0;
      delete menu.dataset.closing;
      menu.close();
    }, 200);
  };
  menuButton.addEventListener('click', () => {
    openedAt = scrollY;
    menu.showModal();
    menuButton.setAttribute('aria-expanded', 'true');
  });
  menu.addEventListener('close', () => menuButton.setAttribute('aria-expanded', 'false'));
  menu.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeMenu();
  });
  menu.addEventListener('click', (e) => {
    const r = menu.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside || (e.target as Element).closest('a, .menu__close')) closeMenu();
  });
  addEventListener('scroll', () => Math.abs(scrollY - openedAt) > 8 && closeMenu(), { passive: true });
  matchMedia('(min-width: 900px)').addEventListener('change', closeMenu);
}

// Copy buttons: data-copy, or the <pre> beside the button. The clipboard API
// needs a secure page; over plain http (npm run demo:phone on a phone) a
// hidden textarea and execCommand do it instead. data-done is held for the
// 1.5 s the icon's animation in style.css takes.
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('.copy')) {
  const label = btn.getAttribute('aria-label') ?? '';
  let timer = 0;
  btn.addEventListener('click', async () => {
    const pre = btn.closest('.code, .cmd, .install')?.querySelector('pre');
    const text = btn.dataset.copy ?? pre?.textContent ?? '';
    try {
      await copyText(text.trim());
    } catch {
      return;
    }
    // A second click restarts the animation.
    delete btn.dataset.done;
    void btn.offsetWidth;
    btn.dataset.done = '';
    btn.setAttribute('aria-label', 'Copied');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      delete btn.dataset.done;
      btn.setAttribute('aria-label', label);
    }, 1500);
  });
}
