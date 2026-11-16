// Unit tests for src/math.ts: the scroll math behind legs, stops, coming to
// rest and opening. Run with `npm test` (Node strips the types itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REST_DELAY_MS,
  SETTLE_SECONDS,
  DEFAULT_REACH,
  createLayout,
  flightAt,
  scrollAt,
  trackHeight,
  flightScreens,
  remapPlace,
  stopLow,
  stopShowingAt,
  settleTarget,
  settleSeconds,
  edgePush,
  atPageEdge,
  PUSH_GAP_MS,
  wheelRun,
  WHEEL_TAKEOVER_PX,
  WHEEL_RUN_MS,
  isGlideEcho,
  GLIDE_SLACK_PX,
  openingMove,
  readyOrder,
  introSeconds,
  labelGlideSeconds,
  barFill,
  currentLabel,
  focusAt,
  pickMode,
  placeStop,
  placeMoment,
  pastEnd,
  stopFromCard,
  parseList,
  reachShare,
  frameShare,
  timeShare,
  startsLater,
  NEAR_SCREENS,
  type StopPoint,
} from '../src/math.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// letramy.com's tour: 713 frames, stops by frame, five legs, no hold.
const at = (frame: number) => (frame - 1) / 712;
const TOUR: StopPoint[] = [
  { at: at(31), focus: [0.48, 0.55] },
  { at: at(94), focus: [0.58, 0.6] },
  { at: at(306), focus: [0.4, 0.6] },
  { at: at(514), focus: [0.34, 0.6] },
  { at: at(713), focus: [0.46, 0.5], from: at(625) },
];
const LEGS = [0.45, 1.3, 1.7, 1.7, 1.6];
const tour = createLayout(TOUR, LEGS, 0);
const reach = { reach: Number((0.38 / 6.75).toFixed(4)), intro: true };

test('rest timing is half a second, then a 1.1 s glide', () => {
  assert.equal(REST_DELAY_MS, 500);
  assert.equal(SETTLE_SECONDS, 1.1);
  assert.equal(DEFAULT_REACH, 0.055);
});

test('without legs, scroll and flight are the same', () => {
  const l = createLayout([{ at: 0.2 }, { at: 0.7 }], null, 0);
  assert.deepEqual(l.knotsScroll, [0, 1]);
  assert.deepEqual(l.stopScroll, [0.2, 0.7]);
  for (const x of [0, 0.13, 0.5, 0.99, 1]) close(flightAt(l, x), x);
});

test('legs: each stop sits at the running total of the legs before it', () => {
  const total = LEGS.reduce((a, b) => a + b, 0);
  let acc = 0;
  tour.stopScroll.forEach((s, i) => {
    acc += LEGS[i];
    close(s, acc / total);
  });
  assert.equal(tour.stopScroll.at(-1), 1);
  assert.equal(tour.legsIgnored, false);
});

test('legs: the flight reaches each stop exactly at its scroll position', () => {
  tour.stopScroll.forEach((s, i) => close(flightAt(tour, s), Math.min(1, TOUR[i].at)));
});

test('legs: flight is monotonic and scrollAt inverts flightAt', () => {
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const sp = i / 1000;
    const f = flightAt(tour, sp);
    assert.ok(f >= prev);
    prev = f;
    close(flightAt(tour, scrollAt(tour, f)), f, 1e-9);
  }
});

test('legs with the wrong count are ignored and reported', () => {
  const l = createLayout(TOUR, [1, 2], 0);
  assert.equal(l.legs, null);
  assert.equal(l.legsIgnored, true);
  assert.deepEqual(l.knotsScroll, [0, 1]);
});

test('hold: a stop on the last frame sits at the end of the hold', () => {
  const stops = [{ at: 0.3 }, { at: 1 }];
  const l = createLayout(stops, [1, 1], 0.5);
  close(l.stopScroll[1], 1);
  close(flightAt(l, 2 / 2.5), 1); // the flight ends before the hold does
  close(flightAt(l, 0.9), 1);
  close(l.stopScroll[0], 1 / 2.5);
});

test("hold without legs: laid out once the flight's length in screens is known", () => {
  const stops = [{ at: 0.5 }, { at: 1 }];
  const early = createLayout(stops, null, 0.6); // before the manifest: left out
  assert.equal(early.hold, 0);
  assert.deepEqual(early.knotsScroll, [0, 1]);
  const flight = flightScreens(720, 14, 900); // 11.2 screens
  close(flight, (720 * 14) / 900);
  const l = createLayout(stops, null, 0.6, flight);
  assert.equal(l.hold, 0.6);
  close(l.knotsScroll[1], flight / (flight + 0.6));
  close(flightAt(l, l.knotsScroll[1]), 1); // the flight ends where the hold starts
  close(flightAt(l, 0.99), 1);
  close(l.stopScroll[1], 1); // a stop on the last frame: the end of the hold
  close(l.stopScroll[0], 0.5 * l.knotsScroll[1]);
  assert.equal(trackHeight(l, 720, 14, 900), 720 * 14 + 900 + 0.6 * 900);
  assert.equal(flightScreens(10, 14, 900), 3); // the track is at least four screens
});

test('remapPlace: the same share of the same stretch in a new layout', () => {
  const stops = [{ at: 1 }];
  const a = createLayout(stops, null, 1, 4); // hold from 0.8
  const b = createLayout(stops, null, 1, 9); // hold from 0.9
  close(remapPlace(a, b, 0.4), 0.45); // half the flight
  close(remapPlace(a, b, 0.9), 0.95); // half the hold
  close(remapPlace(a, b, 1), 1);
  close(remapPlace(tour, tour, 0.37), 0.37);
});

test('track height: legs in screens plus the stage, or length per frame', () => {
  assert.equal(trackHeight(tour, 713, 8, 1000), (6.75 + 1) * 1000);
  const plain = createLayout([{ at: 0.5 }], null, 0);
  assert.equal(trackHeight(plain, 713, 14, 900), 713 * 14 + 900);
  assert.equal(trackHeight(plain, 10, 14, 900), 3600); // at least four screens
});

test('the first stop after an intro shows only in the last third of its approach', () => {
  const s0 = tour.stopScroll[0];
  close(stopLow(tour, TOUR, 0, reach), s0 - Math.min(reach.reach, s0 * 0.35));
  close(stopLow(tour, TOUR, 0, { ...reach, intro: false }), s0 - reach.reach);
});

test("a stop's `from` shows its card early", () => {
  close(stopLow(tour, TOUR, 4, reach), scrollAt(tour, at(625)));
  assert.equal(stopShowingAt(tour, TOUR, scrollAt(tour, at(630)), reach), 4);
});

test('cards show within the window either side of their stop, and not between', () => {
  tour.stopScroll.forEach((s, k) => {
    assert.equal(stopShowingAt(tour, TOUR, s, reach), k);
    if (k > 0) assert.equal(stopShowingAt(tour, TOUR, s - reach.reach * 0.9, reach), k);
    if (k < 4) assert.equal(stopShowingAt(tour, TOUR, s + reach.reach * 0.9, reach), k);
  });
  const mid = (tour.stopScroll[1] + tour.stopScroll[2]) / 2;
  assert.equal(stopShowingAt(tour, TOUR, mid, reach), -1);
});

// Page: 900 px of host content above, a track spanning 6750 px, content below.
const TOP = 900;
const SPAN = 6750;
const yOf = (sp: number) => TOP + sp * SPAN;
const rest = (to: number, o: Partial<{ snap: boolean; returnFirst: boolean }> = {}) =>
  settleTarget(tour, TOUR, { ...reach, to, top: TOP, span: SPAN, snap: true, returnFirst: true, ...o });

test('settle glide: 1.1 s however far by default', () => {
  for (const d of [0, 5, 400, 5000]) assert.equal(settleSeconds(d, 900, false), 1.1);
});

test('settle glide, scaled: 0.6 s plus 0.8 s per screen travelled, 1.4 s at most', () => {
  close(settleSeconds(0, 900, true), 0.6);
  close(settleSeconds(90, 900, true), 0.68);
  close(settleSeconds(450, 900, true), 1);
  close(settleSeconds(-450, 900, true), 1); // gliding up counts the same
  close(settleSeconds(900, 900, true), 1.4);
  assert.equal(settleSeconds(5000, 900, true), 1.4);
  assert.equal(settleSeconds(100, 0, true), 1.1); // no screen height to scale by
});

test('settle: never on host content above or below the track', () => {
  assert.equal(rest(0), null);
  assert.equal(rest(TOP - 2), null);
  assert.equal(rest(TOP + SPAN + 2), null);
  assert.equal(rest(TOP + SPAN + 500), null);
});

test('settle: glides to the stop whose card is showing', () => {
  tour.stopScroll.forEach((s, k) => {
    if (k === 0) return;
    close(rest(yOf(s - reach.reach * 0.5))!, yOf(s));
  });
});

test('settle: stays between cards', () => {
  assert.equal(rest(yOf((tour.stopScroll[1] + tour.stopScroll[2]) / 2)), null);
});

test('settle: stays when already within a pixel of the stop', () => {
  assert.equal(rest(yOf(tour.stopScroll[2]) + 0.5), null);
});

test('settle: return-to-first pulls anywhere above the first stop back to it', () => {
  close(rest(TOP)!, yOf(tour.stopScroll[0]));
  close(rest(TOP + 1)!, yOf(tour.stopScroll[0]));
  assert.equal(rest(TOP + 1, { returnFirst: false }), null);
});

test('settle: snap off turns off only the pull to a showing card', () => {
  const near2 = yOf(tour.stopScroll[1] - reach.reach * 0.5);
  assert.equal(rest(near2, { snap: false }), null);
  close(rest(TOP + 1, { snap: false })!, yOf(tour.stopScroll[0]));
});

test('settle: nothing without stops or without a track to scroll', () => {
  assert.equal(settleTarget(tour, [], { ...reach, to: TOP, top: TOP, span: SPAN, snap: true, returnFirst: true }), null);
  assert.equal(settleTarget(tour, TOUR, { ...reach, to: TOP, top: TOP, span: 0, snap: true, returnFirst: true }), null);
});

const open = (o: Partial<Parameters<typeof openingMove>[0]>) =>
  openingMove({ y: 0, top: 0, hash: false, autoscroll: null, intro: true, start: NaN, firstStop: 0.04, ...o });

test('autoscroll auto: moves the page only when the player is at the top', () => {
  assert.equal(open({}), 'intro');
  assert.equal(open({ intro: false }), 'jump');
  assert.equal(open({ top: 900 }), 'none'); // content above the player
  assert.equal(open({ top: 900, intro: false }), 'none');
});

test('autoscroll off: never; any other value acts as auto', () => {
  assert.equal(open({ top: 900, autoscroll: 'on' }), 'none'); // "on" was dropped before 1.0.0
  assert.equal(open({ autoscroll: 'on' }), 'intro');
  assert.equal(open({ autoscroll: 'off' }), 'none');
  assert.equal(open({ autoscroll: 'off', intro: false }), 'none');
});

test('opening: a scrolled or #linked page is left alone; a position set before boot restores a place', () => {
  assert.equal(open({ y: 500 }), 'none');
  assert.equal(open({ hash: true }), 'none');
  assert.equal(open({ start: 0.5 }), 'start');
  assert.equal(open({ start: 0.5, y: 500 }), 'none');
  assert.equal(open({ firstStop: 0 }), 'none');
});

test('ready set: start frame, the intro in playing order, every 8th frame, a second around', () => {
  const r = readyOrder(713, 30, true, 24);
  assert.equal(r[0], 30);
  assert.deepEqual(r.slice(1, 31), Array.from({ length: 30 }, (_, i) => i));
  assert.equal(new Set(r).size, r.length);
  for (let i = 0; i < 713; i += 8) assert.ok(r.includes(i));
  for (let d = 1; d <= 24; d++) assert.ok(r.includes(30 + d) && r.includes(30 - d));
  assert.ok(!readyOrder(713, 300, false, 24).includes(1));
  assert.ok(readyOrder(10, 9, false, 24).every((i) => i >= 0 && i < 10));
});

test('glide lengths: intro 0.8 to 2.4 s, label tap 0.8 to 3 s', () => {
  assert.equal(introSeconds(1, 24), 0.8);
  close(introSeconds(30, 24), (30 / 24) * 1.15);
  assert.equal(introSeconds(600, 24), 2.4);
  assert.equal(labelGlideSeconds(0.5, 0.5), 0.8);
  close(labelGlideSeconds(0, 0.5), 2);
  assert.equal(labelGlideSeconds(0, 1), 3);
});

test('bar: the fill meets label k when the scroll reaches stop k', () => {
  const s = tour.stopScroll;
  s.forEach((v, k) => close(barFill(s, v), k / (s.length - 1)));
  assert.equal(barFill(s, 0), 0);
  assert.equal(barFill([0.5], 0.7), 0);
});

test('bar: the current label is the showing card, else the nearest stop', () => {
  assert.equal(currentLabel([0.1, 0.5, 0.9], 0.6, 2), 2);
  assert.equal(currentLabel([0.1, 0.5, 0.9], 0.6, -1), 1);
  assert.equal(currentLabel([0.1, 0.5, 0.9], 0, -1), 0);
});

test('focus: each stop has its own point, eased between stops', () => {
  assert.deepEqual(focusAt(TOUR, 0), [0.48, 0.55]);
  assert.deepEqual(focusAt(TOUR, TOUR[1].at), [0.58, 0.6]);
  const mid = focusAt(TOUR, (TOUR[1].at + TOUR[2].at) / 2);
  close(mid[0], 0.49, 1e-9);
  assert.deepEqual(focusAt([], 0.3), [0.5, 0.5]);
  assert.deepEqual(focusAt([{ at: 0.5 }], 0.9), [0.5, 0.5]);
});

test('edge push: wheel momentum against the top or bottom of the page is not scrolling', () => {
  const MAX = 5000;
  // Moving the page counts, even when it reaches the top.
  assert.equal(edgePush(null, -120, 300, MAX, 0), null);
  assert.equal(edgePush(null, -120, 60, MAX, 0), null);
  // At the top, pushing up is a push; down counts.
  const p = edgePush(null, -40, 0, MAX, 0);
  assert.deepEqual(p, { dir: -1, at: 0, rate: 40 / 16 });
  assert.equal(edgePush(null, 40, 0, MAX, 0), null);
  // At the bottom, pushing down is a push.
  assert.ok(edgePush(null, 30, MAX, MAX, 0));
  assert.equal(edgePush(null, -30, MAX, MAX, 0), null);
  // Fading momentum stays the push after a glide moved the page off the top.
  let q = p;
  for (let t = 16, d = 38; d >= 1; t += 16, d *= 0.9) {
    q = edgePush(q, -d, 200, MAX, t);
    assert.ok(q, 'momentum at ' + t + ' ms stays a push');
  }
  // A new flick (faster), a pause, or the other way: counts again.
  const slow = { dir: -1, at: 0, rate: 3 / 16 };
  assert.equal(edgePush(slow, -12, 200, MAX, 16), null);
  assert.equal(edgePush(slow, -2, 200, MAX, PUSH_GAP_MS), null);
  assert.equal(edgePush(slow, 2, 200, MAX, 16), null);
  // A pause at the top starts a new push (still pinned).
  assert.ok(edgePush(slow, -100, 0, MAX, 900));
  assert.equal(edgePush(null, 0, 0, MAX, 0), null);
  // Two frames' events merged into one (twice the size, twice the gap) are
  // the same fading momentum, not a new flick.
  const fading = { dir: -1, at: 0, rate: 4 / 16 };
  assert.ok(edgePush(fading, -7.5, 200, MAX, 32), 'merged events stay the push');
  // Events closer than a frame are not read as faster.
  assert.ok(edgePush(fading, -4, 200, MAX, 3), 'a quick second event stays the push');
  // No vertical part (sideways drift): the push is left as it is.
  assert.equal(edgePush(fading, 0, 200, MAX, 40), fading);
});

test('wheel run: a wheel takes over a glide only once it has really moved', () => {
  // A mouse notch takes over at once.
  assert.ok(wheelRun(null, 100, 0).px >= WHEEL_TAKEOVER_PX);
  // A stray pixel does not, nor a few of them spread out.
  assert.ok(wheelRun(null, 1, 0).px < WHEEL_TAKEOVER_PX);
  let r = wheelRun(null, -2, 0);
  r = wheelRun(r, -2, WHEEL_RUN_MS + 10);
  r = wheelRun(r, -2, 2 * WHEEL_RUN_MS + 20);
  assert.ok(r.px < WHEEL_TAKEOVER_PX, 'spread-out pixels never add up');
  // A gentle real scroll (2 px a frame) gets there within a few frames.
  let g = wheelRun(null, 2, 0);
  let frames = 1;
  for (let t = 16; g.px < WHEEL_TAKEOVER_PX; t += 16, frames++) g = wheelRun(g, 2, t);
  assert.ok(frames <= 3, `took ${frames} frames`);
  // Either direction adds up; no vertical part adds nothing.
  assert.equal(wheelRun(wheelRun(null, -3, 0), 3, 16).px, 6);
  assert.equal(wheelRun(null, 0, 0).px, 0);
});

test('glide echo: a position the glide set lately is not the visitor', () => {
  const trail = [1000, 1000.4, 1034, 1034, 1070.2, 1070];
  // The latest, or one a frame or two late (iOS), is the glide's own.
  assert.equal(isGlideEcho(1070, trail), true);
  assert.equal(isGlideEcho(1034, trail), true);
  assert.equal(isGlideEcho(1000 - GLIDE_SLACK_PX, trail), true);
  // Anywhere else is someone else moving the page.
  assert.equal(isGlideEcho(1150, trail), false);
  assert.equal(isGlideEcho(1052, trail), false);
  assert.equal(isGlideEcho(500, []), false);
});

test('places: a stop by share, by frame number or by seconds', () => {
  // 720 frames at 24 a second, as the demo footage.
  const n = 720;
  // A share lands on the nearest whole frame: 0.25 of 719 steps is 179.75.
  close(placeStop({ at: 0.25 }, n, 24)!.at, 180 / 719);
  // Frames count from 1, as the files do: the first is 0, the last is 1.
  assert.deepEqual(placeStop({ frame: 1 }, n, 24), { at: 0 });
  assert.deepEqual(placeStop({ frame: 720 }, n, 24), { at: 1 });
  close(placeStop({ frame: 49 }, n, 24)!.at, 48 / 719);
  // Seconds: frame 49 is two seconds in.
  close(placeStop({ time: 2 }, n, 24)!.at, 48 / 719);
  assert.deepEqual(placeStop({ time: 0 }, n, 24), { at: 0 });
  // `from` is in the unit of the place.
  close(placeStop({ frame: 720, from: 640 }, n, 24)!.from!, 639 / 719);
  close(placeStop({ time: 29, from: 26 }, n, 24)!.from!, (26 * 24) / 719);
  assert.deepEqual(placeStop({ at: 1, from: 0.9 }, n, 24), { at: 1, from: 0.9 });
  // Past either end is the end; a frame wins over a time, a time over at.
  assert.deepEqual(placeStop({ frame: 5000 }, n, 24), { at: 1 });
  assert.deepEqual(placeStop({ time: 99 }, n, 24), { at: 1 });
  assert.deepEqual(placeStop({ at: -3 }, n, 24), { at: 0 });
  close(placeStop({ frame: 49, time: 20, at: 0.9 }, n, 24)!.at, 48 / 719);
  // No place, or not a number: no stop.
  assert.equal(placeStop({}, n, 24), null);
  assert.equal(placeStop({ at: Number.NaN }, n, 24), null);
  assert.equal(placeStop({ frame: 'door' as unknown as number }, n, 24), null);
  // A number written as text still counts (attributes are text).
  close(placeStop({ at: '0.5' as unknown as number }, n, 24)!.at, 360 / 719);
  // Seconds between two frames land on the nearer one: 2.02 s is frame
  // position 48.48 (frame 49 is at 48), 2.03 s is 48.72.
  close(placeStop({ time: 2.02 }, n, 24)!.at, 48 / 719);
  close(placeStop({ time: 2.03 }, n, 24)!.at, 49 / 719);
  // Every stop is on a whole frame, however it was written.
  for (const s of [{ at: 0.0668 }, { at: 0.3333 }, { time: 7.77 }, { frame: 313 }]) {
    const steps = placeStop(s, n, 24)!.at * 719;
    close(steps, Math.round(steps));
  }
  // Written past the end of the footage.
  assert.equal(pastEnd({ frame: 721 }, n, 24), true);
  assert.equal(pastEnd({ frame: 720 }, n, 24), false);
  assert.equal(pastEnd({ time: 30 }, n, 24), false); // the last frame's second
  assert.equal(pastEnd({ time: 31 }, n, 24), true);
  assert.equal(pastEnd({ at: 1.2 }, n, 24), true);
  assert.equal(pastEnd({ at: 1 }, n, 24), false);
  assert.equal(pastEnd({ frame: 49, at: 5 }, n, 24), false);
  // One frame of footage: every place is the start.
  assert.deepEqual(placeStop({ frame: 1 }, 1, 24), { at: 0 });
  close(frameShare(121, n), 120 / 719);
  close(timeShare(5, n, 24), 120 / 719);
});

test('places: a moment by share, by frame numbers or by seconds', () => {
  const n = 720;
  assert.deepEqual(placeMoment({ from: '0.2', to: '0.33' }, n, 24), { from: 0.2, to: 0.33 });
  const byFrame = placeMoment({ fromFrame: '162', toFrame: '240' }, n, 24)!;
  close(byFrame.from, 161 / 719);
  close(byFrame.to, 239 / 719);
  const byTime = placeMoment({ fromTime: '6', toTime: '10' }, n, 24)!;
  close(byTime.from, 144 / 719);
  close(byTime.to, 240 / 719);
  // Each end in its own unit.
  close(placeMoment({ from: '0.1', toFrame: '240' }, n, 24)!.to, 239 / 719);
  // It has to end after it starts, and both ends have to be there.
  assert.equal(placeMoment({ from: '0.5', to: '0.5' }, n, 24), null);
  assert.equal(placeMoment({ fromFrame: '300', toFrame: '200' }, n, 24), null);
  assert.equal(placeMoment({ from: '0.2' }, n, 24), null);
  assert.equal(placeMoment({}, n, 24), null);
  // Frame numbers written in data-from and data-to are not in the footage.
  assert.equal(placeMoment({ from: '162', to: '240' }, n, 24), null);
  assert.equal(placeMoment({ from: '0.5', to: '240' }, n, 24), null);
  assert.deepEqual(placeMoment({ from: '0', to: '1' }, n, 24), { from: 0, to: 1 });
});

test('a stop written on its card: its data attributes are the stop', () => {
  assert.deepEqual(stopFromCard({ stop: 'lobby', frame: '121', label: 'Lobby', focus: '0.6 0.55', from: '88' }), { id: 'lobby', frame: 121, from: 88, label: 'Lobby', focus: [0.6, 0.55] });
  assert.deepEqual(stopFromCard({ stop: 'door', at: '0.06' }), { id: 'door', at: 0.06 });
  assert.deepEqual(stopFromCard({ stop: 'end', time: '29.5', focus: '0.4,0.5' }), { id: 'end', time: 29.5, focus: [0.4, 0.5] });
  // Attributes the player sets itself, or a focus that is not two numbers, are not part of it.
  assert.deepEqual(stopFromCard({ stop: 'a', at: '1', active: '', focus: '0.5' }), { id: 'a', at: 1 });
  // No place: placeStop then says so.
  assert.equal(placeStop(stopFromCard({ stop: 'lost', label: 'Lost' }), 720, 24), null);
  assert.equal(placeStop(stopFromCard({ stop: 'bad', frame: 'soon' }), 720, 24), null);
  close(placeStop(stopFromCard({ stop: 'lobby', frame: '121' }), 720, 24)!.at, 120 / 719);
});

test('a list of numbers: JSON or plain, every one above 0', () => {
  assert.deepEqual(parseList('[0.45, 1.3, 1.7]'), [0.45, 1.3, 1.7]);
  assert.deepEqual(parseList('0.45 1.3 1.7'), [0.45, 1.3, 1.7]);
  assert.deepEqual(parseList('0.45, 1.3,1.7'), [0.45, 1.3, 1.7]);
  assert.deepEqual(parseList(' 2 '), [2]);
  for (const bad of [null, '', '[]', '1 0 2', '1 -1', 'a b', '{"a":1}', '[1, "2"]']) assert.equal(parseList(bad), null, String(bad));
});

test('reach: written in screen heights, used as a share of the track', () => {
  // letramy's tour: 6.75 screens of legs, a card 0.38 screens either side.
  close(reachShare(0.38, 900, 6.75 * 900), 0.38 / 6.75);
  // The same on any screen with legs; without them it follows the screen.
  close(reachShare(0.38, 600, 6.75 * 600), 0.38 / 6.75);
  close(reachShare(0.5, 800, 10080), 400 / 10080);
  assert.equal(reachShare(null, 900, 6000), DEFAULT_REACH);
  assert.equal(reachShare(0, 900, 6000), 0);
});

test('track height: a box takes its own height in the track, the lengths stay in screens', () => {
  const legs = createLayout([{ at: 0.1 }, { at: 0.5 }, { at: 1 }], [0.5, 1.5, 2], 0);
  // Full-screen: four screens of legs and the screen the stage fills.
  assert.equal(trackHeight(legs, 720, 14, 900), 4500);
  assert.equal(trackHeight(legs, 720, 14, 900, 900), 4500);
  // A box 540 px tall: the same four screens of scroll, and the box.
  assert.equal(trackHeight(legs, 720, 14, 900, 540), 4 * 900 + 540);
  const plain = createLayout([], null, 0);
  assert.equal(trackHeight(plain, 720, 14, 900), 720 * 14 + 900);
  assert.equal(trackHeight(plain, 720, 14, 900, 540), 720 * 14 + 540);
  // The least length (three screens of flight) holds for a box too.
  assert.equal(trackHeight(plain, 20, 14, 900, 540), 3 * 900 + 540);
});

test('mode: stills for reduced motion, a data saver or 2G, unless scrub is forced', () => {
  assert.equal(pickMode(null, false), 'scrub');
  assert.equal(pickMode('auto', false, null), 'scrub');
  assert.equal(pickMode(null, true), 'stills');
  assert.equal(pickMode(null, false, { saveData: true }), 'stills');
  assert.equal(pickMode(null, false, { effectiveType: '2g' }), 'stills');
  assert.equal(pickMode(null, false, { effectiveType: 'slow-2g' }), 'stills');
  assert.equal(pickMode(null, false, { saveData: false, effectiveType: '3g' }), 'scrub');
  assert.equal(pickMode(null, false, { effectiveType: '4g' }), 'scrub');
  // Forced either way, whatever the visitor's settings.
  assert.equal(pickMode('scrub', true, { saveData: true, effectiveType: '2g' }), 'scrub');
  assert.equal(pickMode('stills', false), 'stills');
});

test('lazy start: only a player far below the screen, on a fresh visit, with no place to restore', () => {
  const vh = 900;
  const far = vh * (1 + NEAR_SCREENS) + 1;
  assert.equal(startsLater(far, vh, 'navigate', NaN), true);
  // No navigation timing in this browser: taken as a fresh visit.
  assert.equal(startsLater(far, vh, undefined, NaN), true);
  // At the top of the page, or within two screens below it: at once.
  assert.equal(startsLater(0, vh, 'navigate', NaN), false);
  assert.equal(startsLater(far - 1, vh, 'navigate', NaN), false);
  // Above the screen (the page opened scrolled past it): at once.
  assert.equal(startsLater(-5000, vh, 'navigate', NaN), false);
  // The browser is about to restore a scroll position.
  assert.equal(startsLater(far, vh, 'reload', NaN), false);
  assert.equal(startsLater(far, vh, 'back_forward', NaN), false);
  // `position` set before boot.
  assert.equal(startsLater(far, vh, 'navigate', 0.4), false);
  // A player above has not got its height yet: how far down this one will
  // be is not known, so it waits, wherever it is now. Not on a reload.
  assert.equal(startsLater(vh * 1.5, vh, 'navigate', NaN, true), true);
  assert.equal(startsLater(vh * 1.5, vh, 'reload', NaN, true), false);
  assert.equal(startsLater(vh * 1.5, vh, 'navigate', 0.4, true), false);
});

test('page edge: at or past the top or bottom (a phone bounces past)', () => {
  assert.equal(atPageEdge(0, 5000), true);
  assert.equal(atPageEdge(-30, 5000), true);
  assert.equal(atPageEdge(5000, 5000), true);
  assert.equal(atPageEdge(5040, 5000), true);
  assert.equal(atPageEdge(1, 5000), false);
  assert.equal(atPageEdge(4999, 5000), false);
});
