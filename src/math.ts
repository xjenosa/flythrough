// Pure scroll math for <fly-through>: no DOM, no gsap. flythrough.ts keeps one
// Layout per player and asks these functions every question about positions;
// test/math.test.ts pins the answers. Changing a result here changes how the
// player feels (CLAUDE.md, "Behaviour that must not change").
//
// Two positions run side by side: scroll (0..1 of the track) and flight (0..1
// of the footage). Without legs they are the same. With legs, each leg between
// stops gets its own scroll length, so a short leg is not over in a flick and a
// long one does not drag.

export interface StopPoint {
  at: number; // 0..1 flight position
  from?: number; // 0..1 flight position where its overlay starts showing
  focus?: [number, number];
}

// A place in the footage as the host writes it: `at` (0..1 of the footage),
// `frame` (counted from 1, as the frame files are numbered) or `time`
// (seconds into the footage). A stop's `from` is in the unit of its place.
export interface StopGiven {
  at?: number;
  frame?: number;
  time?: number;
  from?: number;
}

// A stop written on its card: the card's data attributes (el.dataset) as a
// stop. data-stop is its id; data-at, data-frame or data-time its place;
// data-from, data-label and data-focus ("0.6 0.55") as in the stops JSON.
export function stopFromCard(d: Record<string, string | undefined>): StopGiven & { id: string; label?: string; focus?: [number, number] } {
  const s: StopGiven & { id: string; label?: string; focus?: [number, number] } = { id: d.stop ?? '' };
  for (const k of ['at', 'frame', 'time', 'from'] as const) if (d[k] !== undefined) s[k] = Number(d[k]);
  if (d.label !== undefined) s.label = d.label;
  const focus = (d.focus ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  if (focus.length === 2 && focus.every(Number.isFinite)) s.focus = [focus[0], focus[1]];
  return s;
}

// A list of numbers as an attribute gives it: JSON ("[0.45, 1.3]") or plain
// ("0.45 1.3", "0.45, 1.3"). null unless every one is a number above 0.
export function parseList(text: string | null): number[] | null {
  if (!text) return null;
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {}
  if (!Array.isArray(list)) list = text.split(/[\s,]+/).filter(Boolean).map(Number);
  return Array.isArray(list) && list.length > 0 && list.every((n) => typeof n === 'number' && n > 0 && Number.isFinite(n)) ? (list as number[]) : null;
}

// `reach` is written in screen heights; the layout works in shares of the
// track's scroll length (span, px). Not given: DEFAULT_REACH of the track.
export function reachShare(screens: number | null, vh: number, span: number): number {
  return screens === null ? DEFAULT_REACH : (screens * vh) / Math.max(1, span);
}

// 0..1 of the footage for a frame number (from 1) and for seconds.
export const frameShare = (frame: number, frames: number) => clamp01((frame - 1) / Math.max(1, frames - 1));
export const timeShare = (seconds: number, frames: number, fps: number) => clamp01((seconds * fps) / Math.max(1, frames - 1));

// Where a stop sits, as 0..1 of the footage: `at`, and `from` when given.
// null when it has no usable place. frames and fps are the manifest's.
// `at` is put on the nearest whole frame: a stop written in seconds or as a
// share can fall between two, and the page would glide to a place the
// picture then has to step off (draw, at rest).
export function placeStop(s: StopGiven, frames: number, fps: number): { at: number; from?: number } | null {
  const share = (v: unknown) => {
    const n = v === undefined || v === null || v === '' ? NaN : Number(v);
    if (!Number.isFinite(n)) return NaN;
    return s.frame !== undefined ? frameShare(n, frames) : s.time !== undefined ? timeShare(n, frames, fps) : clamp01(n);
  };
  const last = Math.max(1, frames - 1);
  const at = Math.round(share(s.frame ?? s.time ?? s.at) * last) / last;
  if (Number.isNaN(at)) return null;
  const from = share(s.from);
  return Number.isNaN(from) ? { at } : { at, from };
}

// A moment's stretch as 0..1 of the footage, from its data attributes
// (el.dataset): data-from / data-to, or data-from-frame / data-to-frame, or
// data-from-time / data-to-time. null unless it ends after it starts and
// lies in the footage (data-from and data-to given frame numbers do not).
export function placeMoment(d: Record<string, string | undefined>, frames: number, fps: number): { from: number; to: number } | null {
  const end = (share: string | undefined, frame: string | undefined, time: string | undefined) =>
    frame !== undefined ? frameShare(Number(frame), frames) : time !== undefined ? timeShare(Number(time), frames, fps) : Number(share);
  const from = end(d.from, d.fromFrame, d.fromTime);
  const to = end(d.to, d.toFrame, d.toTime);
  return to > from && from >= 0 && to <= 1 ? { from, to } : null;
}

// Whether a stop was written past the end of the footage (it is then put on
// the last frame, placeStop): a frame number above the count, seconds past
// the last frame by more than one, a share above 1.
export function pastEnd(s: StopGiven, frames: number, fps: number): boolean {
  return Number(s.frame) > frames || Number(s.time) * fps > frames || (s.frame === undefined && s.time === undefined && Number(s.at) > 1);
}

// Coming to rest: the wait after the last scroll input, and the glide
// (settleSeconds).
export const REST_DELAY_MS = 500;
export const SETTLE_SECONDS = 1.1;
// Default reach of an overlay either side of its stop (0..1 of the track).
export const DEFAULT_REACH = 0.055;
// Default scroll length per frame without legs (px).
export const DEFAULT_LENGTH = 14;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2);
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface Layout {
  legs: number[] | null; // as given when usable, else null (paced by `length`)
  hold: number; // screen heights after the flight, as laid out (0 until it can be)
  knotsScroll: number[];
  knotsFlight: number[];
  stopScroll: number[]; // each stop's scroll position, same order as the stops
}

// Knots pair scroll positions with flight positions; between knots both move
// linearly. Knot flights: 0, each stop, 1. A hold adds a last knot where the
// scroll goes on and the flight stays at 1. A stop's scroll position is the
// last knot at its flight position (so a stop at 1 sits at the end of a hold).
// `stops` must be sorted by `at`. `legsIgnored` is true when legs were given
// but did not have one length per leg. Without legs a hold needs the flight's
// own scroll length in screen heights (flightScreens), which the player only
// knows once the frame count and the screen height are in; until then it is
// left out (hold 0).
export function createLayout(
  stops: StopPoint[],
  legs: number[] | null,
  hold: number,
  flight?: number,
): Layout & { legsIgnored: boolean } {
  const flights = [0, ...stops.map((s) => clamp01(s.at)).filter((a) => a > 0 && a < 1), 1];
  const uniq = flights.filter((f, i) => i === 0 || f > flights[i - 1]);
  let knotsScroll = [0, 1];
  let knotsFlight = [0, 1];
  let legsIgnored = false;
  if (legs && legs.length === uniq.length - 1) {
    const total = legs.reduce((a, b) => a + b, 0) + hold;
    let acc = 0;
    knotsScroll = [0];
    knotsFlight = [0];
    legs.forEach((len, i) => {
      acc += len;
      knotsScroll.push(acc / total);
      knotsFlight.push(uniq[i + 1]);
    });
    if (hold > 0) {
      knotsScroll.push(1);
      knotsFlight.push(1);
    }
  } else {
    legsIgnored = !!legs;
    legs = null;
    if (hold > 0 && flight && flight > 0) {
      knotsScroll = [0, flight / (flight + hold), 1];
      knotsFlight = [0, 1, 1];
    } else {
      hold = 0;
    }
  }
  const l: Layout = { legs, hold, knotsScroll, knotsFlight, stopScroll: [] };
  l.stopScroll = stops.map((st) => {
    for (let k = knotsFlight.length - 1; k >= 0; k--) if (knotsFlight[k] === clamp01(st.at)) return knotsScroll[k];
    return scrollAt(l, st.at);
  });
  return { ...l, legsIgnored };
}

export function flightAt(l: Layout, sp: number): number {
  const ks = l.knotsScroll;
  const kf = l.knotsFlight;
  for (let k = 0; k < ks.length - 1; k++) {
    if (sp <= ks[k + 1]) {
      const t = ks[k + 1] === ks[k] ? 1 : (sp - ks[k]) / (ks[k + 1] - ks[k]);
      return kf[k] + (kf[k + 1] - kf[k]) * clamp01(t);
    }
  }
  return kf[kf.length - 1];
}

// First scroll position where the flight reaches f.
export function scrollAt(l: Layout, f: number): number {
  const ks = l.knotsScroll;
  const kf = l.knotsFlight;
  for (let k = 0; k < kf.length - 1; k++) {
    if (f <= kf[k + 1] && kf[k + 1] > kf[k]) {
      const t = (f - kf[k]) / (kf[k + 1] - kf[k]);
      return ks[k] + (ks[k + 1] - ks[k]) * clamp01(t);
    }
  }
  return 1;
}

// Track height in px: legs (screen heights) plus hold plus the one screen the
// sticky stage occupies; else `length` px per frame, at least four screens,
// plus the hold. stage: the sticky stage's own height when it is not the
// screen's (a player in a box); the lengths stay in screen heights.
export function trackHeight(l: Layout, frames: number, pxPerFrame: number, vh: number, stage = vh): number {
  if (l.legs) return (l.legs.reduce((a, b) => a + b, 0) + l.hold + 1) * vh + (stage - vh);
  return Math.max(frames * pxPerFrame + vh, vh * 4) + l.hold * vh + (stage - vh);
}

// Without legs: the flight's own scroll length in screen heights (the track
// minus the stage's screen and the hold), as trackHeight lays it out.
export function flightScreens(frames: number, pxPerFrame: number, vh: number): number {
  return vh > 0 ? Math.max((frames * pxPerFrame) / vh, 3) : 3;
}

// The same place in another layout of the same stops: the same share of the
// same knot-to-knot stretch, so a place inside a hold stays inside it.
export function remapPlace(from: Layout, to: Layout, sp: number): number {
  const a = from.knotsScroll;
  const b = to.knotsScroll;
  if (a.length !== b.length) return scrollAt(to, flightAt(from, sp));
  for (let k = 0; k < a.length - 1; k++) {
    if (sp <= a[k + 1]) {
      const t = a[k + 1] === a[k] ? 1 : clamp01((sp - a[k]) / (a[k + 1] - a[k]));
      return b[k] + (b[k + 1] - b[k]) * t;
    }
  }
  return b[b.length - 1];
}

export interface Reach {
  reach: number; // the `reach` attribute
  intro: boolean;
}

// Where stop k's overlay starts showing on the way in. With an intro, the
// first stop's approach is the short opening leg, so its overlay waits until
// the last third of it (the camera nearly at the door) in both directions.
export function stopLow(l: Layout, stops: StopPoint[], k: number, r: Reach): number {
  const s = stops[k];
  const at = l.stopScroll[k];
  let reach = r.reach;
  if (k === 0 && r.intro) reach = Math.min(reach, at * 0.35);
  const lo = at - reach;
  return s.from !== undefined ? Math.min(lo, scrollAt(l, s.from)) : lo;
}

// The stop whose overlay shows at scroll position sp, or -1. One answer for
// what is on screen and for where a resting scroll is pulled (settleTarget).
export function stopShowingAt(l: Layout, stops: StopPoint[], sp: number, r: Reach): number {
  for (let k = 0; k < stops.length; k++) {
    if (sp >= stopLow(l, stops, k, r) && sp <= l.stopScroll[k] + r.reach) return k;
  }
  return -1;
}

export interface Rest extends Reach {
  to: number; // page y the scroll is resting at or heading to
  top: number; // page y of the track's top
  span: number; // track height minus the screen height
  snap: boolean;
  returnFirst: boolean;
}

// Where a resting scroll glides to, as a page y, or null to leave it. Only
// inside the track: content above or below the player is the host page's.
//   - the first stop, from anywhere in the track above it (returnFirst);
//   - else the stop whose overlay is showing (snap).
// Between overlays the scroll stays where it is left.
export function settleTarget(l: Layout, stops: StopPoint[], o: Rest): number | null {
  if (!stops.length || o.span <= 0) return null;
  if (o.to < o.top - 1 || o.to > o.top + o.span + 1) return null;
  const sp = clamp01((o.to - o.top) / o.span);
  let k = -1;
  if (o.returnFirst && sp < l.stopScroll[0]) k = 0;
  else if (o.snap) k = stopShowingAt(l, stops, sp, o);
  if (k < 0) return null;
  const y = o.top + clamp01(l.stopScroll[k]) * o.span;
  if (Math.abs(o.to - y) <= 1) return null;
  return y;
}

// How long the rest rule's glide takes. By default SETTLE_SECONDS however far
// it goes. With glide="scaled" it follows the distance: 0.6 s plus 0.8 s per
// screen height travelled, 1.4 s at most, so a short nudge settles quickly
// and a long return takes its time. Only this glide: the intro and label
// taps keep their own timing (introSeconds, labelGlideSeconds).
export function settleSeconds(distance: number, vh: number, scaled: boolean): number {
  if (!scaled || !(vh > 0)) return SETTLE_SECONDS;
  return Math.min(1.4, 0.6 + (0.8 * Math.abs(distance)) / vh);
}

// Pushing against the top or bottom of the page is not scrolling, for the
// rest rule. A touchpad keeps sending wheel events for a second or more after
// the finger lifts (momentum), also once the page can no longer move; timing
// the rest from them held the glide back until the momentum died out (1.8 s
// after a flick instead of about 0.6). A push starts with a wheel event
// toward an edge the page is already at, and goes on while events keep coming
// the same way less than PUSH_GAP_MS apart and no faster than the one before
// (momentum only fades; a new flick builds up). Speed, not size: a browser
// can merge two frames' events into one twice the size, which is not a new
// flick (judged by size, it ended the push and the rest of the momentum
// dragged the glide back to the top). An event with no vertical part (a
// touchpad's sideways drift) leaves the push as it is. It stays a push after
// a glide has moved the page off the edge, so its tail cannot take the glide
// over. Returns the push the event belongs to, or null: the event counts.
export const PUSH_GAP_MS = 120;
const FRAME_MS = 16;
export interface Push {
  dir: number; // -1 toward the top, 1 toward the bottom
  at: number; // ms, its last event
  rate: number; // px per ms, its last event: its size over the time since the one before, a frame at least
}
export function edgePush(push: Push | null, delta: number, pos: number, max: number, now: number): Push | null {
  const dir = Math.sign(delta);
  if (!dir) return push;
  const mag = Math.abs(delta);
  if (push && dir === push.dir && now - push.at < PUSH_GAP_MS) {
    const rate = mag / Math.max(now - push.at, FRAME_MS);
    if (rate <= push.rate * 1.2 + 1 / FRAME_MS) return { dir, at: now, rate };
  }
  const pinned = dir < 0 ? pos <= 0.5 : pos >= max - 0.5;
  return pinned ? { dir, at: now, rate: mag / FRAME_MS } : null;
}

// A wheel takes over a glide only once it has really moved: WHEEL_TAKEOVER_PX
// of travel from events less than WHEEL_RUN_MS apart. A real scroll gets there
// in its first event or two (a mouse notch is about 100 px); a stray event of
// a pixel or two from a touchpad (fingers resting or lifting, the end of a
// momentum tail) does not, so it no longer stops a glide short for a second
// glide to finish the trip half a second later. Returns the run so far.
export const WHEEL_TAKEOVER_PX = 6;
export const WHEEL_RUN_MS = 150;
export interface WheelRun {
  px: number; // travel so far
  at: number; // ms, its last event
}
export function wheelRun(run: WheelRun | null, delta: number, now: number): WheelRun {
  const kept = run && now - run.at < WHEEL_RUN_MS ? run.px : 0;
  return { px: kept + Math.abs(delta), at: now };
}

// Without Lenis the player watches its own glide for a takeover, in place of
// ScrollToPlugin's autoKill: the page somewhere the glide did not put it (a
// scrollbar drag, host code, a swipe) takes over. A position the glide itself
// set in its last frames is not that: iOS can report one a frame or two late
// (WebKit bug 236312), and autoKill, which compares with the last value only
// (7 px), took it for the visitor and stopped long glides part way.
export const GLIDE_SLACK_PX = 7;
export function isGlideEcho(y: number, trail: readonly number[]): boolean {
  return trail.some((v) => Math.abs(y - v) <= GLIDE_SLACK_PX);
}

// At or past the top or bottom of the page: a scroll event there is the page
// arriving at the edge or a phone's bounce past it, not the visitor scrolling.
export function atPageEdge(pos: number, max: number): boolean {
  return pos <= 0 || pos >= max;
}

// Stills instead of the flight: asked for (mode="stills"), or, unless
// mode="scrub" forces the flight, a visitor who prefers reduced motion, has a
// data saver on, or is on a 2G connection (hundreds of frames would not
// arrive). conn is navigator.connection, which only Chromium has.
export function pickMode(
  attr: string | null,
  reduced: boolean,
  conn?: { saveData?: boolean; effectiveType?: string } | null,
): 'scrub' | 'stills' {
  if (attr === 'stills') return 'stills';
  if (attr === 'scrub') return 'scrub';
  return reduced || conn?.saveData === true || /2g/.test(conn?.effectiveType ?? '') ? 'stills' : 'scrub';
}

// Lazy start: a player whose top is more than NEAR_SCREENS screen heights
// below the screen loads nothing until the visitor is that near. One below a
// player that has not got its height yet (`unsized`: its manifest is still
// on its way) cannot tell how far down it will be, so it waits to see. Only
// on a fresh visit: on a reload or a back or forward navigation the browser
// puts the scroll back where it was, which needs the page at its full
// height. Not with a place to restore either (`position` set before boot:
// start).
// top: the player's top from the top of the screen; navType: the page's
// PerformanceNavigationTiming type, undefined where the browser has none.
export const NEAR_SCREENS = 2;
export function startsLater(top: number, vh: number, navType: string | undefined, start: number, unsized = false): boolean {
  return (unsized || top > vh * (1 + NEAR_SCREENS)) && (navType ?? 'navigate') === 'navigate' && !Number.isFinite(start);
}

export interface Opening {
  y: number; // page scroll when the manifest arrives
  top: number; // page y of the track's top
  hash: boolean; // the URL has a #fragment
  autoscroll: string | null; // attribute value
  intro: boolean;
  start: number; // `position` set before boot, NaN when unset
  firstStop: number; // flight position of the first stop, 0 without stops
}

// What the player does to the page as it opens. Nothing unless the page is
// fresh (not scrolled past the track's top, no #fragment). Moving the page
// (intro glide, jump to the first stop) is autoscroll's call: auto (any
// value but off) only when the player is at the top of the screen, off never.
// A position set before boot restores a place and is not autoscroll's to
// refuse.
export function openingMove(o: Opening): 'start' | 'intro' | 'jump' | 'none' {
  const fresh = o.y <= o.top + 2 && !o.hash;
  const mayMove = fresh && o.autoscroll !== 'off' && o.y >= o.top - 2;
  if (fresh && Number.isFinite(o.start)) return 'start';
  if (o.intro && mayMove && o.firstStop > 0) return 'intro';
  if (o.firstStop > 0 && mayMove) return 'jump';
  return 'none';
}

// Frames that must be in before the loading screen lifts, in loading order:
// the start frame, with an intro every frame from 0 to it (in playing order),
// every 8th frame (a rough whole flight), then a second either side.
export function readyOrder(frames: number, start: number, intro: boolean, fps: number): number[] {
  const seen = new Uint8Array(frames);
  const out: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < frames && !seen[i]) {
      seen[i] = 1;
      out.push(i);
    }
  };
  push(start);
  if (intro) for (let i = 0; i < start; i++) push(i);
  for (let i = 0; i < frames; i += 8) push(i);
  const second = Math.round(fps || 24);
  for (let d = 1; d <= second; d++) {
    push(start + d);
    push(start - d);
  }
  return out;
}

// The opening glide: close to the footage's own speed (slower reads as
// stutter), at least 0.8 s, at most 2.4 s.
export function introSeconds(frames: number, fps: number): number {
  return Math.min(2.4, Math.max(0.8, (frames / (fps || 24)) * 1.15));
}

// A label tap flies through the footage, never a cut: longer trips get more
// time, capped at 3 s.
export function labelGlideSeconds(fromSp: number, toSp: number): number {
  return Math.min(3, 0.8 + Math.abs(fromSp - toSp) * 2.4);
}

// Labels are evenly spaced; the fill runs piecewise so it meets label k
// exactly when the scroll reaches stop k. Returns 0..1 of the bar.
export function barFill(stopScroll: number[], x: number): number {
  const s = stopScroll;
  const n = s.length;
  if (n < 2) return 0;
  let seg = 0;
  while (seg < n - 2 && x > s[seg + 1]) seg++;
  const a = s[seg];
  const b = s[seg + 1];
  const t = b === a ? 1 : clamp01((x - a) / (b - a));
  return (seg + t) / (n - 1);
}

// The label marked current: the stop whose overlay is showing, else the
// nearest one (a stop with `from` shows well before it is the nearest).
export function currentLabel(stopScroll: number[], x: number, showing: number): number {
  if (showing >= 0) return showing;
  let best = 0;
  for (let i = 1; i < stopScroll.length; i++) if (Math.abs(x - stopScroll[i]) < Math.abs(x - stopScroll[best])) best = i;
  return best;
}

// Where the subject sits in the frame at flight position p: each stop's focus,
// eased between stops with smoothstep. The frame maker crops portrait sets
// along the same path.
export function focusAt(stops: StopPoint[], p: number): [number, number] {
  const s = stops;
  if (!s.length) return [0.5, 0.5];
  const f = (st: StopPoint): [number, number] => st.focus ?? [0.5, 0.5];
  if (p <= s[0].at) return f(s[0]);
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (p <= b.at) {
      const t = b.at === a.at ? 1 : smoothstep((p - a.at) / (b.at - a.at));
      const fa = f(a);
      const fb = f(b);
      return [fa[0] + (fb[0] - fa[0]) * t, fa[1] + (fb[1] - fa[1]) * t];
    }
  }
  return f(s[s.length - 1]);
}
