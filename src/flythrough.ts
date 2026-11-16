// <fly-through>: a scroll-driven frame player with named stops.
//
// The player's class, shared by both package entries. It imports no library:
// how far the page has scrolled through the track, and the glide without
// Lenis, come from the engine its entry hands it (engine.ts; define() at the
// end of this file). dist/index.js ("flythrough") hands it GSAP's
// ScrollTrigger and ScrollToPlugin; dist/no-gsap.js ("flythrough/no-gsap")
// the browser's scroll events and no glide of its own. Importing it must not
// touch window or document (server rendering): browser work starts in
// connectedCallback. Scrolling and glides are the libraries' own, never
// hand-rolled here: lenis.scrollTo when the host calls
// player.useLenis(lenis), else the engine's (GSAP's ScrollToPlugin). Where a resting scroll
// goes is the player's own rule either way (see settle), with the same wait,
// reach and glide.
//
//   <fly-through src="/tour/v1/manifest.json"
//                 stops='[{"id":"welcome","at":0,"label":"Welcome","focus":[0.5,0.5]}, ...]'>
//     <div data-stop="welcome">...overlay shown at that stop...</div>
//   </fly-through>
//
// Two positions run side by side: scroll (0..1 of the track) and flight (0..1
// of the footage). Without `legs` they are the same. With it, each leg between
// stops gets its own scroll length, so a short leg is not over in a flick and a
// long one does not drag.
//
// Attributes: src (manifest URL), stops (JSON, for frameworks; in HTML a stop
// is written on its card instead: data-stop="<id>" with data-at, data-frame
// or data-time, and data-from, data-label, data-focus="x y". A stop is
// placed by `at`, 0..1 of the footage, or by `frame`, counted from 1, or by
// `time`, in seconds; its optional `from`, in the same unit, shows its
// overlay early and keeps it to the stop), length
// (px of scroll per frame, default 14; ignored with legs), legs (JSON: scroll
// length in viewport heights of each leg between 0, the stops and 1), hold
// (viewport heights the last frame stays after the flight ends, with or
// without legs), fit (cover|contain), snap ("off": a resting scroll is never
// pulled to the stop whose overlay is showing), glide ("scaled": that pull
// takes 0.6 to 1.4 s by distance instead of a fixed 1.1 s), return-to-first
// ("on"|"off": a resting scroll anywhere in the track above the first stop
// glides back to it; default on with intro, off without), reach (screen
// heights an overlay counts as active either side of its stop; left out,
// 0.055 of the scroll track; also how far from a stop a resting scroll is
// pulled to it), mode
// (auto|scrub|stills; read, never rewritten: the mode in use shows as the
// `stills` attribute), loading-text, bar ("off": no stop bar), intro (open at frame 0 and glide
// to the first stop once the frames are in, instead of opening on the first
// stop), autoscroll (auto|off, whether the player may move the page as it
// loads, by the intro glide or the jump to the first stop; auto: only when
// the page opens with the player at the top of the screen; off: never).
// Where "off" turns a setting off (snap, bar, return-to-first, autoscroll,
// intro), "false" does too: a framework can leave either in the page.
// Property: position (0..1 scroll position of the track, null in stills mode
// or before boot; writable: before boot it is where the player opens, after
// it the page jumps there).
// Methods: goToStop(i), useLenis(lenis), holdLoading(ms | promise).
// Children: [data-stop="<id>"] overlays, and [data-moment] with data-from /
// data-to (flight positions; or data-from-frame / data-to-frame, or
// data-from-time / data-to-time): passing text shown while the flight is
// between them, with no snap and no label. Both stay hidden (flythrough.css) until
// the player moves them into its stage or its stills. [data-poster]: an
// <img> or <picture> of the frame the player opens on; it fills the first
// screen until the canvas has drawn (or the stills are in), and with
// scripting off it is the picture above the stops.
// Events: flythrough-ready, flythrough-progress {progress, position, frame}
// (progress: 0..1 of the flight; position: 0..1 of the track, as the
// `position` property; frame: counted from 1), flythrough-stop {id, active}.
// Hyphens, not colons: a colon cannot be written as a JSX prop. Stills send
// only flythrough-ready.
// State attributes the element sets: ready, loaded (every frame in), error
// (nothing to show: the player collapses), stills, intro-reveal, boxed (the
// host gave --ft-stage-height: the stage is a box of that height, pinned in
// the middle of the screen, instead of the whole screen).
// [data-progress], on any element inside the player: the player sets
// --ft-progress on it, 0..1 of the flight (the event's `progress`), for the
// host's own CSS; not in stills. On those elements only, never on the player
// itself: an inherited property written there every scroll step restyles
// everything inside it (measured on the demo, phone at CPU 4x: 62 to 100
// slow frames in a six-second scroll, against none).
import type { Engine, Tracker } from './engine.js';
import { loadManifest, pickSet, frameUrl, manifestBase, type Manifest, type FrameSet } from './manifest.js';
import {
  REST_DELAY_MS,
  PUSH_GAP_MS,
  flightScreens,
  remapPlace,
  settleSeconds,
  edgePush,
  atPageEdge,
  type Push,
  wheelRun,
  WHEEL_TAKEOVER_PX,
  type WheelRun,
  isGlideEcho,
  DEFAULT_REACH,
  DEFAULT_LENGTH,
  easeInOutCubic,
  easeOutSine,
  clamp01,
  createLayout,
  flightAt,
  trackHeight,
  stopShowingAt,
  settleTarget,
  openingMove,
  readyOrder,
  introSeconds,
  labelGlideSeconds,
  barFill,
  currentLabel,
  focusAt,
  placeStop,
  placeMoment,
  pastEnd,
  stopFromCard,
  parseList,
  reachShare,
  pickMode,
  startsLater,
  NEAR_SCREENS,
  type Layout,
  type Reach,
} from './math.js';

// The parts of a Lenis instance the player uses. Structural, so the type files
// do not need lenis installed (it is an optional peer).
export interface LenisLike {
  on(event: 'scroll' | 'virtual-scroll', cb: (...args: any[]) => void): unknown;
  off(event: 'scroll' | 'virtual-scroll', cb: (...args: any[]) => void): unknown;
  scrollTo(
    target: number,
    opts?: {
      duration?: number;
      easing?: (t: number) => number;
      lock?: boolean;
      immediate?: boolean;
      force?: boolean;
      onComplete?: () => void;
    },
  ): unknown;
  resize(): unknown;
  readonly targetScroll: number;
  readonly limit: number;
  readonly isScrolling: boolean | 'native' | 'smooth';
  // Lenis reads options.virtualScroll on every wheel and touch event, before
  // anything else; returning false drops the event (setupRest).
  options: { virtualScroll?: (data: LenisInput) => boolean | void };
}
interface LenisInput {
  deltaX: number;
  deltaY: number;
  event: WheelEvent | TouchEvent;
}

// On a server there is no HTMLElement; the class must still evaluate so the
// module can be imported there (it is never constructed).
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

export interface Stop {
  id: string;
  // Its place in the flight, one of the three:
  at?: number; // 0..1 of the footage
  frame?: number; // a frame, counted from 1 as the frame files are numbered
  time?: number; // seconds into the footage
  from?: number; // where its overlay starts showing, in the unit of its place
  label?: string;
  focus?: [number, number]; // 0..1 point to keep in view when the frame is cropped
}
// A stop once the manifest has said how many frames there are (place()).
type Placed = Stop & { at: number };

// `detail` of flythrough-progress and flythrough-stop (typed for
// addEventListener at the end of this file).
export interface ProgressDetail {
  progress: number; // 0..1 of the flight
  position: number; // 0..1 of the track, as the `position` property
  frame: number; // the frame shown, counted from 1 as the frame files are
}
export interface StopDetail {
  id: string;
  active: boolean; // its overlay shows, or has just hidden
}

// The number on the loading screen trails the real share of the ready set:
// each animation frame it closes part of the gap (time constant
// COUNT_EASE_MS) and never passes it, so it counts up evenly while frames
// arrive in bursts. As the screen lifts it runs out to 100 within
// COUNT_FINISH_MS, or a share of the fade when that is shorter.
const COUNT_EASE_MS = 140;
const COUNT_FINISH_MS = 200;
// The page is held still at most this long while the loading screen is up.
const FREEZE_CAP_MS = 15000;
// Keys that scroll the page: without Lenis they count as scrolling for the
// rest rule and take over from a glide; while loading, they are held back.
const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End']);
// Without Lenis: the glide's positions kept for its takeover check
// (isGlideEcho in math.ts), this many frames back.
const GLIDE_ECHO_FRAMES = 6;
// A frame that fails is asked for again after each of these waits, then
// counted as done so the loading screen can still lift (draw() shows the
// nearest frame that did load). An answer that says the file is not there
// (404 and the like) is not asked again. When no frame has loaded and
// GIVE_UP_AFTER frames (or the whole ready set, if smaller) have failed, the
// frames are not there at all: the player collapses (fail()).
const RETRY_MS = [600, 2000];
const GIVE_UP_AFTER = 12;
// Frames asked for at once. Twelve against six: a phone on 4G had the tour
// usable in 3.2 s instead of 3.9 s, and every frame in after 11.6 s, not 17.
const CONCURRENT = 12;
const LIFT_WAIT_MS = 1000;
// The longest the loading screen waits with nothing arriving: for the
// manifest, and then from one frame to the next (watchStall).
const STALL_MS = 20000;
// At rest between two frames: after STILL_MS without the flight moving, the
// mix of the two runs out to the nearer one over UNBLEND_MS (draw).
const STILL_MS = 250;
const UNBLEND_MS = 150;
// Bitmaps kept around the current frame: AHEAD the way the flight moves,
// BEHIND the other way, IDLE either side when it is still; SLACK more before
// one is closed, so a visitor rocking back and forth does not decode again.
const AHEAD = 16;
const BEHIND = 4;
const IDLE = 10;
const SLACK = 4;
const MAX_STARTS = 6;
const MAX_CLOSES = 4;
// Decodes in flight at most: an engine that decodes slowly must not queue up
// frames the visitor has already passed ahead of the ones now wanted.
const MAX_DECODING = 8;
const HOLD_MAX = AHEAD + BEHIND + 1 + 2 * SLACK + 2;
// Lazy start, across every player on the page: how many have started and
// not got their height yet, and the ones waiting to be near (sizing,
// watchNear). A player's height is waited for this long at most, so one
// whose manifest never answers cannot hold the others back.
// Set once, by the first entry loaded (define).
let engine: Engine;
// On an engine without a glide and with no Lenis: said once. Also when the
// intro finds no Lenis as the manifest comes in (start): it then opens on
// the first stop.
let saidNoGlide = false;
function noGlide() {
  if (!saidNoGlide) console.warn('flythrough/no-gsap: glides need Lenis (player.useLenis(lenis), right after the import); without it a stop is jumped to and the intro opens on the first stop');
  saidNoGlide = true;
}
let unsized = 0;
const waiting = new Set<Flythrough>();
const SIZE_WAIT_MS = 4000;

export class Flythrough extends Base {
  // No field, getter or method may be named after an attribute (stops, mode,
  // fit, snap, reach, glide ...): React, Vue and Svelte set a prop as a
  // property when the element has one of that name, and settings are read
  // from attributes. test/features-test.mjs checks every attribute's name.
  private lenis?: LenisLike;
  private restVia: 'lenis' | 'native' | null = null; // what the rest rule listens to
  private restTimer = 0;
  private glideNow?: { kill(): void }; // the engine's glide, without Lenis
  private glideTrail: number[] = []; // without Lenis: where the glide put the page lately (onGlideScroll)
  private lenisGlideUntil = 0; // ms: with Lenis, the player's glide runs until then (0: none)
  private wheelTravel: WheelRun | null = null; // wheel travel during a glide (wheelRun)
  private touching = false;
  private push: Push | null = null; // wheel momentum against a page edge (edgePush)
  private seenY = 0; // without Lenis: the scroll position at the last scroll event
  private restLenis?: LenisLike; // the Lenis the rest rule listens to
  private settleWaitAt = 0; // ms: settle first held back by a bounce or push, 0 if not
  private hostFilter?: (data: LenisInput) => boolean | void; // the host's own Lenis virtualScroll
  // intro: between the loading screen lifting and the opening glide starting.
  private opening = false;
  private built = false; // connectedCallback has run once: a later call is a move
  private booted = false; // start() has run: trigger, listeners, loading
  private srcless = false; // it joined the page without src: it starts when src is set (applyChanges)
  // The manifest, asked for before the parts are built (connectedCallback).
  private asked?: Promise<Manifest>;
  // Lazy start: the load put off until the player is near the screen
  // (undefined once it has run), and what watches for that.
  private later?: () => void;
  private near?: IntersectionObserver;
  private unsizedNow = false; // counted in `unsized` (sizing)
  private sizeTimer = 0;
  // Bumped on removal: loading pumps from before it stop (frames already
  // asked for still land and count).
  private loadGen = 0;
  private introTimer = 0;
  // position set before boot: where the player opens (NaN: not set).
  private pendingPos = NaN;
  // Page scroll once the opening move is made (start): a visitor who scrolls
  // away from it while the frames load has taken over, so the intro is skipped.
  private openY = 0;

  private manifest?: Manifest;
  private set?: FrameSet;
  private base = '';
  // Frames arrive as files (fetch, kept as Blobs) and are decoded off the main
  // thread into ImageBitmaps only near the visitor (warmDecode), so drawing
  // never decodes and memory stays bounded. Where that cannot work, frames
  // are <img>s instead (useImg), the browser decoding them at draw:
  // createImageBitmap missing; a cross-origin host without CORS (fetch fails,
  // an <img> loads); and WebKit (Safari, and every browser on iOS), whose
  // createImageBitmap decodes one frame at a time and holds up the page
  // (measured: 16 ms each, in series, stalls up to 63 ms; a fast scrub left
  // the picture hundreds of frames behind), while its img.decode() does warm
  // what the canvas draws. A frame is drawable once it has a bitmap or an
  // img (pic()).
  private useImg = false;
  private crossOrigin = false; // frames come from another origin than the page
  private blobs: (Blob | undefined)[] = [];
  private bitmaps: (ImageBitmap | undefined)[] = [];
  private held = new Set<number>(); // indexes with a bitmap
  private decoding: Uint8Array = new Uint8Array(0);
  private decodingCount = 0;
  private undecodable: Uint8Array = new Uint8Array(0);
  private imgs: (HTMLImageElement | undefined)[] = [];
  private loaded: Uint8Array = new Uint8Array(0);
  private failed: Uint8Array = new Uint8Array(0); // gave up after every retry
  private failedCount = 0;
  private tries: Uint8Array = new Uint8Array(0);
  private decodedAt: Int32Array = new Int32Array(0);
  private inFlight: Uint8Array = new Uint8Array(0);
  private loadedCount = 0;
  // The ready set is in but the start frame is not drawn yet (its bitmap is
  // still decoding): the veil waits for it, LIFT_WAIT_MS at most.
  private liftWaiting = false;
  private liftWaitOver = false; // LIFT_WAIT_MS ran out: lift without the start frame drawn
  private frozen = false; // the page is held still while the loading screen is up
  private freezeTimer = 0;
  // The page opened with the player at the top of the screen (start): only
  // then is it held still while the loading screen is up.
  private holdsPage = false;
  private stallTimer = 0; // watchStall
  private stalled = false; // STALL_MS passed with nothing arriving: lift on what is in
  private gaveUp = false; // fail() ran: nothing more is loaded or shown
  // Frames that must be in before the loading screen lifts: the start frame,
  // every 8th frame (a rough whole flight), a second either side of the start,
  // and with an intro every frame from 0 to the start.
  private readyQueue: number[] = [];
  private readySet: Uint8Array = new Uint8Array(0);
  private readyTotal = 0;
  private startProgress = 0;
  // intro: the glide from frame 0 to the first stop is still to play.
  private introPending = false;
  private warmLo = -1;
  private warmHi = -1;
  private warmAt = 0;

  // The stops as the host wrote them; stopList once the manifest is in
  // (place()), in flight order, each with its `at`.
  private stopsGiven: Stop[] = [];
  private stopList: Placed[] = [];
  private placed = false;
  // A player in a box (--ft-stage-height on the element, readBox): the
  // stage's own height stands where the screen's does for a full-screen
  // player, and the track starts where the box pins, stageTop px from the
  // top of the screen.
  private boxed = false;
  private stageTop = 0;
  private kind: 'scrub' | 'stills' = 'scrub';
  private fitTo: 'cover' | 'contain' = 'cover';
  private pxPerFrame = DEFAULT_LENGTH;
  private snapOn = true;
  private scaledGlide = false; // glide="scaled"
  private returnFirst = false;
  private activeDist = DEFAULT_REACH; // reach as a share of the track (layoutTrack)
  private reachGiven: number | null = null; // the reach attribute, screen heights
  private introOn = false; // the intro attribute
  private barOff = false; // bar="off"
  // Attributes changed while the player runs, taken together in a microtask
  // (attributeChangedCallback, applyChanges); "cards" for the card children.
  private changes = new Set<string>();
  private cardWatch?: MutationObserver;
  private legsAsked: number[] | null = null; // the legs attribute, as parsed
  private legsGiven: number[] | null = null; // the legs attribute, when usable
  private holdGiven = 0; // the hold attribute, screen heights

  private shareEls: HTMLElement[] = []; // the host's [data-progress] elements
  private shareSet = ''; // --ft-progress as last written to them
  private scrollPos = 0; // 0..1 of the scroll track
  private progress = 0; // 0..1 of the flight
  // Scroll/flight knots and each stop's scroll position (math.ts).
  private layout: Layout = createLayout([], null, 0);
  private momentEls: HTMLElement[] = [];
  private moments: { el: HTMLElement; from: number; to: number; on: boolean; t: number }[] = [];
  private frame = 0;
  private framePos = 0; // exact position between two frames, for blending
  private drawn = -1;
  private drawnKey = -1;
  private drawnPos = 0; // framePos at the last draw: how fast the flight moves
  private shownA = -1; // the frames on the canvas (B: the cross-faded one, or -1)
  private shownB = -1;
  private stillTimer = 0;
  private stillAt = 0; // ms: when the flight was found still, STILL_MS after its last move (0: moving)
  private needsRedraw = true;
  private ready = false;

  private track!: HTMLElement;
  private probe?: HTMLElement; // measures 100lvh, see lvh()
  private stage!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayBox!: HTMLElement;
  private overlays = new Map<string, HTMLElement>();
  // The host's [data-poster], until the first frame is drawn over it.
  private posterEl?: HTMLElement | null;
  private activeStop: string | null = null;
  private barEl?: HTMLElement;
  private fill?: HTMLElement;
  private labels: HTMLButtonElement[] = [];
  private loadingEl?: HTMLElement;
  private loadNum?: HTMLElement; // .ft__loading-num, the counting number
  private readyShare = 0; // real: 0..1 of the ready set in
  private realShown = 0; // eased toward readyShare, never ahead of it
  private shownShare = 0; // what the number shows: realShown, held to the clock by holdMs
  // holdLoading: the loading screen stays up at least holdMs from veilAt, and
  // until every promise handed in has settled (heldBy counts those pending).
  private holdMs = 0;
  private heldBy = 0;
  private veilAt = 0; // when the loading screen appeared (performance.now)
  private minTimer = 0;
  private countRaf = 0;
  private countAt = 0;
  private liftAt = 0;
  private liftFrom = 0;
  private liftMs = 0;

  private st?: Tracker;
  private ro?: ResizeObserver;
  private rafId = 0;
  private dpr = 1;

  connectedCallback() {
    if (this.built) {
      this.resume();
      return;
    }
    // A script that runs while the page is still being read (async, or in
    // the head without defer) meets the element before its children: the
    // cards, moments and poster are there once something after the element
    // is, or the whole page.
    if (document.readyState === 'loading') {
      let n: Node | null = this;
      while (n && !n.nextSibling) n = n.parentNode;
      if (!n) {
        document.addEventListener('DOMContentLoaded', () => this.isConnected && !this.built && this.connectedCallback(), { once: true });
        return;
      }
    }
    this.built = true;
    // `position` set on the element before it was upgraded is an own property
    // hiding the class's setter: hand it to the setter.
    if (Object.prototype.hasOwnProperty.call(this, 'position')) {
      const early = (this as { position?: unknown }).position;
      delete (this as { position?: unknown }).position;
      this.position = early as number;
    }

    const src = this.getAttribute('src');
    if (!src) {
      // A page that sets src after adding the element: it starts then
      // (applyChanges). Said only if src is still missing after this task.
      this.srcless = true;
      this.built = false;
      queueMicrotask(() => this.hasAttribute('src') || console.warn('flythrough: missing src'));
      return;
    }
    this.srcless = false;
    this.changes.clear();
    this.base = manifestBase(src);
    // Lazy start (startsLater), decided first: a player that starts now asks
    // for its manifest here, before its parts are built, so the answer is on
    // its way while the page works.
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    const lazy =
      typeof IntersectionObserver !== 'undefined' &&
      startsLater(this.getBoundingClientRect().top, window.innerHeight, nav?.type, this.pendingPos, unsized > 0);
    if (!lazy) this.asked = this.getManifest(src);
    engine.setup();

    this.readSettings();
    this.kind = pickMode(
      this.getAttribute('mode'),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection,
    );
    this.toggleAttribute('stills', this.kind === 'stills');
    this.readBox();

    this.posterEl = this.querySelector<HTMLElement>(':scope > [data-poster]');
    this.shareEls = Array.from(this.querySelectorAll<HTMLElement>('[data-progress]'));
    // Overlays are the children the host wrote; they move into the stage.
    const overlayEls = Array.from(this.querySelectorAll<HTMLElement>(':scope > [data-stop]'));
    for (const el of overlayEls) this.overlays.set(el.dataset.stop!, el);
    this.momentEls = Array.from(this.querySelectorAll<HTMLElement>(':scope > [data-moment]'));
    this.readStops();

    if (this.kind === 'scrub') this.buildScrub(overlayEls);
    const load = () => {
      this.sizing(true);
      if (this.kind === 'stills') this.buildStills(src, overlayEls);
      else void this.boot(src);
    };
    if (!lazy) return load();
    this.later = load;
    this.watchNear();
  }

  // The manifest, or an error once it has not answered for STALL_MS: a host
  // that never answers must not leave the loading screen up for good.
  private getManifest(src: string): Promise<Manifest> {
    return new Promise((ok, no) => {
      window.setTimeout(() => no(new Error(`flythrough: manifest ${src} did not answer in ${STALL_MS / 1000} s`)), STALL_MS);
      loadManifest(src).then(ok, no);
    });
  }

  // "off" or "false": a framework can leave either in the page for a
  // setting that is turned off.
  private isOff(name: string): boolean {
    const v = this.getAttribute(name);
    return v === 'off' || v === 'false';
  }

  // An attribute that is there and not turned off.
  private flag(name: string): boolean {
    return this.hasAttribute(name) && !this.isOff(name);
  }

  // Every setting that can change while the player runs, read from its
  // attribute: at the start, and again whenever one changes (applyChanges).
  private readSettings() {
    this.fitTo = this.getAttribute('fit') === 'contain' ? 'contain' : 'cover';
    this.pxPerFrame = Number(this.getAttribute('length') || DEFAULT_LENGTH);
    this.snapOn = !this.isOff('snap');
    this.scaledGlide = this.getAttribute('glide') === 'scaled';
    this.introOn = this.flag('intro');
    this.returnFirst = this.hasAttribute('return-to-first') ? !this.isOff('return-to-first') : this.introOn;
    const reach = Number(this.getAttribute('reach'));
    this.reachGiven = this.hasAttribute('reach') && Number.isFinite(reach) && reach >= 0 ? reach : null;
    this.legsAsked = parseList(this.getAttribute('legs'));
    this.holdGiven = Math.max(0, Number(this.getAttribute('hold')) || 0);
    this.barOff = this.isOff('bar');
  }

  // The stops: the `stops` attribute when it is there (JSON, what a
  // framework passes), else the cards themselves (stopFromCard in math.ts).
  private readStops() {
    const json = this.getAttribute('stops');
    if (json === null) {
      this.stopsGiven = Array.from(this.overlays.values(), (el) => stopFromCard(el.dataset));
      return;
    }
    try {
      const given = JSON.parse(json || '[]');
      this.stopsGiven = Array.isArray(given) ? given : [];
    } catch {
      console.warn('flythrough: stops is not valid JSON; no stops');
      this.stopsGiven = [];
    }
  }

  // Settings that take effect when changed while the player runs. src and
  // mode are read at the start only: they decide what is built.
  static observedAttributes = ['stops', 'legs', 'hold', 'length', 'reach', 'snap', 'glide', 'return-to-first', 'intro', 'fit', 'loading-text', 'bar-label', 'bar', 'src', 'mode'];

  // Also runs for each attribute as the element is created, before
  // connectedCallback: nothing to do then.
  attributeChangedCallback(name: string, was: string | null, now: string | null) {
    if ((this.built || this.srcless) && was !== now) this.changed(name);
  }

  // Several changes in one go (a framework setting stops and legs) are one
  // change: stops and legs have to agree with each other.
  private changed(name: string) {
    if (!this.changes.size) queueMicrotask(() => this.applyChanges());
    this.changes.add(name);
  }

  private applyChanges() {
    const c = this.changes;
    // Off the page: kept for when it is back (resume).
    if (!this.isConnected) return;
    this.changes = new Set();
    if (this.srcless) {
      if (this.hasAttribute('src')) this.connectedCallback();
      return;
    }
    if (this.gaveUp || (this.kind === 'scrub' && !this.overlayBox)) return;
    const fixed = ['src', 'mode'].filter((name) => c.has(name));
    if (fixed.length) {
      console.warn(`flythrough: ${fixed.join(' and ')} is read when the player starts; use a new <fly-through> (in a framework, a new key)`);
    }
    if (c.size === fixed.length) return;
    if (this.kind === 'stills') {
      if (this.ready) console.warn('flythrough: showing stills; settings changed now have no effect');
      else this.readSettings(), this.readStops();
      return;
    }
    this.readSettings();
    const text = this.loadingEl?.querySelector('.ft__loading-text');
    if (text) text.textContent = this.getAttribute('loading-text') || 'Loading';
    const stops = c.has('stops') || c.has('cards');
    if (stops) {
      this.adoptCards();
      this.readStops();
    }
    // Before the manifest is in, start() works from what was just read.
    if (!this.booted || !this.manifest) return;
    if (stops || c.has('legs') || c.has('hold') || c.has('length')) {
      // The same place in the flight under the new layout (layoutTrack).
      const was = this.layout;
      this.placeAtResize = this.scrollPos;
      this.scrollPos = -1;
      this.placed = false;
      this.place(this.manifest);
      this.layoutTrack(was);
      if (this.scrollPos < 0) this.setProgress(this.st?.progress ?? 0);
    } else if (c.has('reach')) {
      this.layoutTrack();
    }
    if (stops || c.has('bar') || c.has('bar-label')) {
      this.barEl?.remove();
      this.barEl = this.fill = undefined;
      this.labels = [];
      if (!this.barOff && this.stopList.length) this.stage.insertBefore(this.buildBar(), this.overlayBox);
    }
    if (c.has('fit')) this.sizeCanvas();
    if (!this.hasAttribute('error')) {
      if ((this.snapOn || this.returnFirst) && this.stopList.length) this.setupRest();
      else this.dropRest();
    }
    this.updateStops(stops);
    this.updateMoments();
    this.updateBar();
    this.needsRedraw = true;
    this.scheduleDraw();
    if (this.ready && this.restVia) this.watchRest();
  }

  // Cards and moments the host added to the element after the start move
  // into the stage like the first ones; ones the host took out are dropped.
  private adoptCards() {
    for (const el of Array.from(this.querySelectorAll<HTMLElement>(':scope > [data-stop], :scope > [data-moment]'))) this.overlayBox.append(el);
    this.overlays.clear();
    for (const el of Array.from(this.overlayBox.querySelectorAll<HTMLElement>(':scope > [data-stop]'))) this.overlays.set(el.dataset.stop!, el);
    this.momentEls = Array.from(this.overlayBox.querySelectorAll<HTMLElement>(':scope > [data-moment]'));
  }

  // The cards are settings too: a card added to the element, or a place,
  // label or focus changed on one, is a change like an attribute's.
  private watchCards() {
    this.cardWatch ??= new MutationObserver(() => this.changed('cards'));
    this.cardWatch.observe(this, { childList: true });
    this.cardWatch.observe(this.overlayBox, {
      subtree: true,
      attributeFilter: ['data-stop', 'data-at', 'data-frame', 'data-time', 'data-from', 'data-to', 'data-label', 'data-focus', 'data-from-frame', 'data-to-frame', 'data-from-time', 'data-to-time'],
    });
  }

  // Lazy start (startsLater in math.ts): nothing is asked for, the manifest
  // included, until the player is within NEAR_SCREENS screen heights of the
  // screen, and every player that started before it has its height. A scrub
  // player waits as one screen under its loading screen. A new observer each
  // time: its first report says where the player is now.
  private watchNear() {
    waiting.add(this);
    this.near?.disconnect();
    this.near = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && !unsized && this.startNow(), {
      rootMargin: `${NEAR_SCREENS * 100}% 0px`,
    });
    this.near.observe(this);
  }

  private startNow() {
    this.near?.disconnect();
    this.near = undefined;
    waiting.delete(this);
    const load = this.later;
    this.later = undefined;
    if (!load) return;
    // holdLoading's least time counts from here, not from a wait unseen.
    this.veilAt = performance.now();
    load();
  }

  // on: this player has started and its height is still to come (the track's
  // from the manifest, or the stills). off: it has it, or never will (failed,
  // removed, or SIZE_WAIT_MS passed). When none is left, the waiting players
  // look again at how far down they are.
  private sizing(on: boolean) {
    if (on === this.unsizedNow) return;
    this.unsizedNow = on;
    window.clearTimeout(this.sizeTimer);
    if (on) {
      unsized++;
      this.sizeTimer = window.setTimeout(() => this.sizing(false), SIZE_WAIT_MS);
    } else if (!--unsized) {
      for (const p of waiting) p.watchNear();
    }
  }

  // Removed from the page (for good, or moved: a framework re-parenting it
  // calls this and then connectedCallback). Everything that listens to or acts
  // on the page stops; what was built and loaded is kept for resume().
  disconnectedCallback() {
    this.near?.disconnect();
    this.cardWatch?.disconnect();
    this.followLenis(false);
    waiting.delete(this);
    this.sizing(false);
    this.loadGen++;
    this.st?.kill();
    this.st = undefined;
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.dropRest();
    this.stopGlide();
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.introTimer);
    cancelAnimationFrame(this.countRaf);
    this.countRaf = 0;
    window.clearTimeout(this.minTimer);
    this.minTimer = 0;
    this.liftWaiting = false;
    this.liftWaitOver = false;
    window.clearTimeout(this.stallTimer);
    window.clearTimeout(this.stillTimer);
    this.freezeScroll(false);
  }

  // Back in a page after disconnectedCallback. Before the manifest arrived,
  // boot() starts it; stills mode holds nothing to restart. A removed intro is
  // not replayed.
  private resume() {
    if (this.overlayBox) this.watchCards();
    this.followLenis(true);
    if (this.changes.size) queueMicrotask(() => this.applyChanges());
    if (this.later) return this.watchNear();
    if (this.kind !== 'scrub' || !this.manifest || this.hasAttribute('error')) return;
    if (!this.booted) return this.start();
    this.opening = false;
    this.createTrigger();
    window.addEventListener('resize', this.onResize);
    this.ro?.observe(this.stage);
    this.layoutTrack();
    this.sizeCanvas();
    this.setupRest();
    if (!this.ready && this.holdsPage) this.freezeScroll(true);
    this.countOn();
    this.pump();
    if (!this.ready) this.checkReady();
    this.needsRedraw = true;
    this.scheduleDraw();
  }

  // Optional. Hand the player the page's Lenis instance: the rest rule then
  // listens to Lenis and every glide is lenis.scrollTo. Call before or after
  // the player boots.
  useLenis(lenis: LenisLike) {
    this.stopGlide();
    this.followLenis(false);
    this.lenis = lenis;
    this.followLenis(this.isConnected);
    if (this.booted && !this.hasAttribute('error')) this.setupRest();
  }

  // An engine that reads the browser's scroll events (flythrough/no-gsap)
  // hears of a Lenis step a frame late; Lenis's own event comes in the frame.
  private onLenisFrame = () => this.st?.sync?.();
  private followLenis(on: boolean) {
    if (engine.glides || !this.lenis) return;
    if (on) this.lenis.on('scroll', this.onLenisFrame);
    else this.lenis.off('scroll', this.onLenisFrame);
  }

  get position(): number | null {
    return this.kind === 'scrub' && this.booted ? this.scrollPos : null;
  }

  // Before boot (the manifest not yet in): where the player opens, instead of
  // the first stop or the intro, e.g. to restore a visitor's place; ignored if
  // the page has already scrolled past the player's top or has a #fragment.
  // After boot: a cut there, not a glide, and the rest rule is asked once, as
  // if the visitor had scrolled there. Ignored in stills mode.
  set position(sp: number | null) {
    const x = Number(sp);
    if (sp === null || !Number.isFinite(x)) return;
    if (!this.booted) {
      this.pendingPos = clamp01(x);
      // A place to restore: a player waiting to be near starts now.
      this.startNow();
      return;
    }
    if (this.kind !== 'scrub' || this.gaveUp) return;
    window.clearTimeout(this.introTimer);
    this.introPending = false;
    this.opening = false;
    this.stopGlide();
    this.jumpTo(clamp01(x));
    if (this.ready && this.restVia) this.watchRest();
  }

  // Keeps the loading screen up longer, for a host's own reason: a number is
  // the least time in ms from when the screen appeared (the count on it then
  // keeps to the clock, so a quick load counts up evenly over that time); a
  // promise holds it until the promise settles (the count waits short of 100).
  // Calls add up. After the screen has lifted, and in stills mode (no loading
  // screen), it does nothing. Everything that waits for the lift (the ready
  // event and attribute, label taps, the intro) waits for it too.
  holdLoading(until: number | PromiseLike<unknown>) {
    if (this.ready || this.gaveUp || this.kind === 'stills') return;
    if (typeof until === 'number') {
      if (Number.isFinite(until) && until > this.holdMs) this.holdMs = until;
      return;
    }
    this.heldBy++;
    // Not tied to loadGen: a player moved in the page meanwhile still lifts.
    const done = () => {
      this.heldBy--;
      if (this.booted && this.isConnected && !this.ready && !this.gaveUp) this.checkReady();
    };
    Promise.resolve(until).then(done, done);
  }

  // Each stop's scroll position (0..1 of the track). test/host-test.mjs reads it.
  private get stopScroll(): number[] {
    return this.layout.stopScroll;
  }

  private get reachOf(): Reach {
    return { reach: this.activeDist, intro: this.introOn };
  }

  // ---------------------------------------------------------------- DOM

  private buildScrub(overlayEls: HTMLElement[]) {
    this.track = document.createElement('div');
    this.track.className = 'ft__track';
    this.stage = document.createElement('div');
    this.stage.className = 'ft__stage';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ft__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.overlayBox = document.createElement('div');
    this.overlayBox.className = 'ft__overlays';
    for (const el of overlayEls) this.overlayBox.append(el);
    for (const el of this.momentEls) this.overlayBox.append(el);

    // The bar (start() adds it, once the stops are placed) comes before the
    // overlays: Tab reaches the stop labels first and then the showing card's
    // links (only the showing card is visible, so only its links take focus).
    // Drawn above both by its z-index.
    this.stage.append(this.canvas);
    // Over the canvas (which is black until drawn), under the loading screen.
    if (this.posterEl) this.stage.append(this.posterEl);
    this.stage.append(this.overlayBox);

    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'ft__loading';
    this.loadingEl.setAttribute('role', 'status');
    // Built as elements, never innerHTML: loading-text and labels are text.
    const span = (cls: string, text = '') => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = text;
      return el;
    };
    const loadBar = span('ft__loading-bar');
    loadBar.append(document.createElement('i'));
    // A live region: only the text is read out, once, not every percent.
    loadBar.setAttribute('aria-hidden', 'true');
    // The number and its sign are separate so a host can hide the sign.
    const pct = span('ft__loading-pct');
    pct.setAttribute('aria-hidden', 'true');
    this.loadNum = span('ft__loading-num', '0');
    pct.append(this.loadNum, span('ft__loading-sign', '%'));
    this.loadingEl.append(span('ft__loading-text', this.getAttribute('loading-text') || 'Loading'), loadBar, pct);
    this.stage.append(this.loadingEl);
    this.veilAt = performance.now();

    this.probe = document.createElement('div');
    this.probe.className = 'ft__probe';
    this.track.append(this.stage, this.probe);
    this.append(this.track);
    this.watchCards();
  }

  private buildBar(): HTMLElement {
    this.barEl = document.createElement('nav');
    this.barEl.className = 'ft__bar';
    this.barEl.setAttribute('aria-label', this.getAttribute('bar-label') || 'Stops');
    const line = document.createElement('div');
    line.className = 'ft__line';
    this.fill = document.createElement('div');
    this.fill.className = 'ft__fill';
    line.append(this.fill);
    // A toolbar: one Tab stop for all the labels (the current one), arrow keys
    // between them, so Tab from the labels goes straight to the card.
    const list = document.createElement('div');
    list.className = 'ft__labels';
    list.setAttribute('role', 'toolbar');
    list.addEventListener('keydown', this.onLabelKey);
    this.stopList.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ft__label';
      b.tabIndex = i === 0 ? 0 : -1;
      b.dataset.index = String(i);
      const dot = document.createElement('i');
      dot.className = 'ft__dot';
      const name = document.createElement('span');
      name.textContent = s.label ?? s.id;
      b.append(dot, name);
      b.addEventListener('click', () => this.goToStop(i));
      list.append(b);
      this.labels.push(b);
    });
    this.barEl.append(line, list);
    // A tap on the bar is not a scroll gesture. Lenis reads touchend as one,
    // which would cut a label glide short and arm the rest rule against it.
    // Keep bar touches away from Lenis's window listeners.
    for (const ev of ['touchstart', 'touchmove', 'touchend'] as const) {
      this.barEl.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    return this.barEl;
  }

  // Left/Right (and Home/End) move focus along the labels; Enter or Space
  // then flies there. Home/End are taken here, not left to scroll the page.
  private onLabelKey = (e: KeyboardEvent) => {
    const at = this.labels.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    const last = this.labels.length - 1;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    this.focusLabel(Math.max(0, Math.min(last, to)));
  };

  private focusLabel(i: number) {
    this.labels.forEach((b, k) => (b.tabIndex = k === i ? 0 : -1));
    this.labels[i]?.focus();
  }

  private buildStills(src: string, overlayEls: HTMLElement[]) {
    const box = document.createElement('div');
    box.className = 'ft__stills';
    this.append(box);
    (this.asked ?? this.getManifest(src))
      .then((m) => {
        this.manifest = m;
        this.place(m);
        const { set } = pickSet(m, this.boxSize(box));
        this.set = set;
        // Every stop and every moment is one screen over its still (a
        // moment's from the middle of its stretch), so the page keeps an even
        // rhythm however the host spaced them. Only the first picture loads
        // eagerly.
        const screen = (at: number, focus: [number, number] | undefined, alt: string, el: HTMLElement | undefined) => {
          const sec = document.createElement('section');
          sec.className = 'ft__still';
          const img = document.createElement('img');
          img.src = frameUrl(this.base, set, Math.round(clamp01(at) * (m.frames - 1)) + 1);
          img.alt = alt;
          img.decoding = 'async';
          if (box.childElementCount) img.loading = 'lazy';
          img.style.objectPosition = focus ? `${focus[0] * 100}% ${focus[1] * 100}%` : '50% 50%';
          sec.append(img);
          if (el) {
            el.setAttribute('data-active', '');
            sec.append(el);
          }
          box.append(sec);
          return sec;
        };
        // A moment's picture is scenery: its text says what it is.
        const momentScreen = (mo: { el: HTMLElement; from: number; to: number }) =>
          screen((mo.from + mo.to) / 2, undefined, '', mo.el).classList.add('ft__still--moment');
        let mi = 0;
        for (const s of this.stopList) {
          while (mi < this.moments.length && this.moments[mi].from < s.at) momentScreen(this.moments[mi++]);
          screen(s.at, s.focus, s.label ?? s.id, this.overlays.get(s.id)).dataset.still = s.id;
        }
        for (; mi < this.moments.length; mi++) momentScreen(this.moments[mi]);
        // Overlays without a stop still render, at the end.
        for (const el of overlayEls) if (!box.contains(el)) box.append(el);
        // The first still is the same picture.
        this.posterEl?.remove();
        this.ready = true;
        this.setAttribute('ready', '');
        this.sizing(false);
        this.say('flythrough-ready');
        this.warnStyle();
      })
      .catch((err) => this.fail(err));
  }

  // ---------------------------------------------------------------- boot

  private async boot(src: string) {
    try {
      // Missing, not JSON, or not a manifest (loadManifest checks it).
      this.manifest = await (this.asked ?? this.getManifest(src));
    } catch (err) {
      return this.fail(err);
    }
    if (this.isConnected && !this.gaveUp) this.start();
  }

  // Nothing to show (no usable manifest, or no frame loads): the player
  // collapses (fly-through[error] in the stylesheet) so the host page reads on
  // without a blank screen, and lets go of the page for good.
  private fail(err: unknown) {
    if (this.gaveUp) return;
    console.error(err);
    this.gaveUp = true;
    this.loadGen++;
    this.setAttribute('error', '');
    this.sizing(false);
    this.loadingEl?.remove();
    this.freezeScroll(false);
    this.dropRest();
    this.stopGlide();
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.introTimer);
    window.clearTimeout(this.stallTimer);
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    cancelAnimationFrame(this.countRaf);
    this.countRaf = 0;
    if (this.st) {
      this.st.kill();
      this.st = undefined;
      engine.refresh();
      this.lenis?.resize();
    }
  }

  // The stops and moments get their places in the flight, which a frame
  // number or a time only has once the manifest says how many frames there
  // are and how fast they play. Then the layout, which needs the stops.
  private place(m: Manifest) {
    if (this.placed) return;
    this.placed = true;
    const fps = m.fps || 24;
    this.stopList = [];
    for (const s of this.stopsGiven) {
      const at = placeStop(s, m.frames, fps);
      if (at) this.stopList.push({ ...s, from: undefined, ...at });
      else console.warn(`flythrough: stop "${s?.id}" has no place (at, frame or time); ignored`);
      if (at && pastEnd(s, m.frames, fps)) console.warn(`flythrough: stop "${s.id}" is past the end of the footage (${m.frames} frames); put on the last frame`);
    }
    // With `stops` given, a card is found by its id.
    for (const id of this.overlays.keys()) {
      if (!this.stopList.some((s) => s.id === id) && this.hasAttribute('stops')) console.warn(`flythrough: the card data-stop="${id}" matches no stop; it never shows`);
    }
    this.stopList.sort((a, b) => a.at - b.at);
    // Without legs a hold also needs the screen height (layoutTrack lays it
    // out again).
    const layout = createLayout(this.stopList, this.legsAsked, this.holdGiven);
    if (layout.legsIgnored) console.warn('flythrough: legs needs one length per leg between 0, the stops and 1; ignored');
    this.layout = layout;
    this.legsGiven = layout.legs;
    this.moments = [];
    for (const el of this.momentEls) {
      el.removeAttribute('data-active');
      const span = placeMoment(el.dataset, m.frames, fps);
      if (span) this.moments.push({ el, ...span, on: false, t: -1 });
      else console.warn('flythrough: a moment needs data-from below data-to, both 0 to 1 (by frame: data-from-frame, data-to-frame; by seconds: data-from-time, data-to-time); ignored', el);
    }
    this.moments.sort((a, b) => a.from - b.from);
  }

  private start() {
    const m = this.manifest!;
    // Before anything is added to the page: picking the set reads the
    // window's size, and every such read after a change makes the browser
    // lay the page out again (the bar added first cost a slow phone 24 ms
    // here, before the first frame was asked for). The bar goes in last.
    const { set } = pickSet(m, this.boxSize(this.stage));
    this.set = set;
    this.place(m);
    this.useImg = typeof createImageBitmap !== 'function' || navigator.vendor === 'Apple Computer, Inc.';
    this.crossOrigin = new URL(frameUrl(this.base, set, 1), location.href).origin !== location.origin;
    this.imgs = new Array(m.frames);
    this.blobs = new Array(m.frames);
    this.bitmaps = new Array(m.frames);
    this.decoding = new Uint8Array(m.frames);
    this.undecodable = new Uint8Array(m.frames);
    this.loaded = new Uint8Array(m.frames);
    this.failed = new Uint8Array(m.frames);
    this.tries = new Uint8Array(m.frames);
    this.decodedAt = new Int32Array(m.frames).fill(-1);
    this.inFlight = new Uint8Array(m.frames);

    this.layoutTrack();
    this.ro ??= new ResizeObserver(() => {
      // The track is laid out in the next frame, never inside the observer's
      // callback: a new track height (a turned phone, a resized window)
      // changes the page's height, and a box that comes or goes (a media
      // query) the stage's own size. Inside the callback the browser reports
      // either as a loop (an error in Safari's console, a window error event
      // everywhere) whenever html or body is watched too: Lenis watches
      // html, gsap-engine.ts body.
      const box = this.boxNow() !== this.boxed;
      if (!box) this.sizeCanvas();
      // The place to keep is the one of this moment (or the resize event's,
      // when that came first), not what the scroll reads a frame later.
      if (this.placeAtResize === null) this.placeAtResize = this.scrollPos;
      requestAnimationFrame(() => {
        if (!this.isConnected) {
          this.placeAtResize = null;
          return;
        }
        this.layoutTrack();
        if (box) this.sizeCanvas();
      });
    });
    this.ro.observe(this.stage);
    this.sizeCanvas();

    this.createTrigger();

    // Open on the first stop, not frame 0, unless the browser restored a scroll
    // position (reload mid-tour) or the visitor already scrolled. With intro,
    // stay on frame 0 and glide there once ready (playIntro). With a position
    // set before boot, open there; startProgress follows it so the ready set
    // surrounds that frame. Moving the page on load (the intro glide, the jump
    // to the first stop) is `autoscroll`'s call: by default only when the page
    // opens with the player at the top of the screen, so content a host put
    // above the player is never scrolled away from as the page loads.
    this.startProgress = this.stopList[0]?.at ?? 0;
    const start = this.pendingPos;
    this.pendingPos = NaN;
    const y = window.scrollY;
    const top = this.rangeTop();
    const autoOff = this.isOff('autoscroll');
    let move = openingMove({
      y,
      top,
      hash: !!location.hash,
      autoscroll: autoOff ? 'off' : null,
      intro: this.introOn,
      start,
      firstStop: this.startProgress,
    });
    if (move === 'intro' && !this.lenis && !engine.glides) {
      move = 'jump';
      noGlide();
    }
    if (move === 'start') {
      this.startProgress = flightAt(this.layout, clamp01(start));
      this.jumpTo(clamp01(start));
    } else if (move === 'intro') {
      this.introPending = true;
      this.setProgress(0);
    } else if (move === 'jump') {
      this.jumpTo(this.stopScroll[0]);
    } else {
      // A few px short of the top of the screen (the browsers' own 8px
      // margin on body) is not at the top, and nothing else on the page
      // shows why the tour then does not open: said.
      if (top - y > 2 && top <= 32 && this.startProgress > 0 && !autoOff && !location.hash) {
        console.warn(`flythrough: the player starts ${Math.round(top)}px below the top of the page (a margin on body?), so the page does not open on the tour: no intro, no jump to the first stop. Remove the gap (body { margin: 0 })`);
      }
      // The page stays where it is, so that is where the player opens: the
      // ready set surrounds that frame, and it is the picture behind the
      // loading screen.
      this.startProgress = this.progress;
    }

    this.openY = this.scrollNow();
    this.booted = true;
    window.addEventListener('resize', this.onResize);
    this.setupRest();
    // Held still under the loading screen (freezeScroll) only when the page
    // opened with the player at the top of the screen: a visitor who
    // scrolls down the page into a player still loading is never stopped
    // there (owner).
    this.holdsPage = Math.abs(y - top) <= 2;
    if (this.holdsPage) this.freezeScroll(true);
    this.startLoading();
    // After the frames are asked for, and after every read of the page's
    // layout above.
    if (!this.barEl && !this.barOff && this.stopList.length) {
      this.stage.insertBefore(this.buildBar(), this.overlayBox);
      this.updateBar();
    }
    this.warnLayout();
    this.sizing(false);
  }

  // Two host-page layouts break the player without an error, so they get a
  // console warning naming the element:
  //   - the page scrolls inside a box instead of the window (a wrapper with
  //     overflow, Lenis's wrapper option): the player follows only the
  //     window's scroll, so it never moves.
  //   - an ancestor has overflow hidden, auto or scroll on either axis (often
  //     `overflow-x: hidden` against sideways scrolling): that makes it the
  //     box the sticky stage pins to, so the picture scrolls away with the
  //     page. `overflow: clip` clips the same without that side effect.
  // body's overflow passes to the window (and does not count) while html's
  // is visible; html's always does.
  private warnLayout() {
    const root = getComputedStyle(document.documentElement);
    const rootVisible = root.overflowX === 'visible' && root.overflowY === 'visible';
    const boxes = new Set(['hidden', 'auto', 'scroll']);
    for (let el = this.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (el === document.body && rootVisible) continue;
      const cs = getComputedStyle(el);
      if (!boxes.has(cs.overflowX) && !boxes.has(cs.overflowY)) continue;
      if (cs.overflowY !== 'hidden' && el.scrollHeight > el.clientHeight + 1) {
        console.warn('flythrough: the page scrolls inside a box; the player follows the window scroll only', el);
      } else {
        console.warn('flythrough: an element around the player has overflow hidden, auto or scroll, so the picture cannot stay pinned; use overflow: clip', el);
      }
      return;
    }
  }

  // ScrollTrigger maps scroll to progress, nothing more: coming to rest is the
  // player's own rule (settle), with or without Lenis.
  private createTrigger() {
    this.st?.kill();
    this.st = engine.track({
      trigger: this.track,
      ...(this.boxed && { start: () => this.rangeTop() }),
      // Measured against the large viewport (lvh()), not the visible one, so
      // the mapping does not change when a phone's address bar shows or hides.
      span: () => Math.max(1, this.rangeSpan()),
      update: (progress) => this.setProgress(progress),
    });
  }

  // Coming to rest. Half a second after the visitor stops scrolling, with no
  // finger on the screen, and only inside the track (content above or below
  // the player is the host page's, never pulled), the scroll glides to:
  //   - the stop whose overlay is showing (unless snap="off"). A card on
  //     screen with the scroll resting off its stop reads as a dead zone, so
  //     the pull reaches exactly as far as the overlay does, a stop's early
  //     `from` included.
  //   - the first stop, from anywhere in the track above it (return-to-first,
  //     on by default with intro): the way in can be scrubbed back through,
  //     but the camera always returns.
  // Between overlays the scroll stays where it is left.
  // "Stops scrolling" is the last wheel, touch or key, or the last scroll
  // event the player did not cause itself, whichever is later, so a phone is
  // judged after it has finished coasting. The player's own glides never
  // re-arm the timer: with Lenis their scroll events are 'smooth', not
  // 'native'; without it they are ignored while a glide runs. So on a computer
  // the pull starts half a second after the last wheel notch, not after the
  // tail. Pushing against the top or bottom of the page is not scrolling
  // either (edgePush, atPageEdge in math.ts): wheel momentum there, and scroll
  // events at or past the edge (a phone's bounce), never re-arm the timer.
  // Not Lenis Snap (it judged a phone mid-coast) and not ScrollTrigger's
  // snap (nearest stop from anywhere): the same rule and timing either way.
  private setupRest() {
    if ((!this.snapOn && !this.returnFirst) || !this.stopList.length) return;
    // Nothing to glide with (flythrough/no-gsap before it has Lenis).
    if (!this.lenis && !engine.glides) return;
    const via = this.lenis ? 'lenis' : 'native';
    if (this.restVia === via && this.restLenis === this.lenis) return;
    this.dropRest();
    this.restVia = via;
    this.restLenis = this.lenis;
    if (this.lenis) {
      this.lenis.on('scroll', this.onLenisScroll);
      this.lenis.on('virtual-scroll', this.watchRest);
      this.hostFilter = this.lenis.options.virtualScroll;
      this.lenis.options.virtualScroll = this.lenisFilter;
    } else {
      this.seenY = window.scrollY;
      window.addEventListener('scroll', this.onNativeScroll, { passive: true });
      window.addEventListener('wheel', this.onNativeWheel, { passive: true });
      window.addEventListener('keydown', this.onNativeKey);
    }
    // Capture: the bar stops its touches from bubbling (buildBar).
    window.addEventListener('touchstart', this.onTouch, { passive: true, capture: true });
    window.addEventListener('touchend', this.onTouch, { passive: true, capture: true });
    window.addEventListener('touchcancel', this.onTouch, { passive: true, capture: true });
  }

  private dropRest() {
    const lenis = this.restLenis;
    if (this.restVia === 'lenis' && lenis) {
      lenis.off('scroll', this.onLenisScroll);
      lenis.off('virtual-scroll', this.watchRest);
      if (lenis.options.virtualScroll === this.lenisFilter) lenis.options.virtualScroll = this.hostFilter;
      this.hostFilter = undefined;
    } else if (this.restVia === 'native') {
      window.removeEventListener('scroll', this.onNativeScroll);
      window.removeEventListener('wheel', this.onNativeWheel);
      window.removeEventListener('keydown', this.onNativeKey);
    }
    window.removeEventListener('touchstart', this.onTouch, true);
    window.removeEventListener('touchend', this.onTouch, true);
    window.removeEventListener('touchcancel', this.onTouch, true);
    this.restVia = null;
    this.restLenis = undefined;
    this.push = null;
  }

  private watchRest = () => {
    window.clearTimeout(this.restTimer);
    this.settleWaitAt = 0;
    this.restTimer = window.setTimeout(this.settle, REST_DELAY_MS);
  };

  private pageMax(): number {
    const root = document.scrollingElement ?? document.documentElement;
    return Math.max(0, root.scrollHeight - window.innerHeight);
  }

  // With Lenis: every wheel event passes through here before Lenis uses it.
  // A push against a page edge is dropped, its default prevented too (Lenis's
  // wheel listener is not passive, and Lenis prevents every wheel event it
  // takes from the first, so the browser keeps them cancelable): it neither
  // re-arms the rest timer (no virtual-scroll event follows) nor moves the
  // page, so momentum still pushing up when the glide back starts cannot drag
  // the page back. The host's own virtualScroll runs first, as before.
  // During the player's own glide, a wheel event too small to be the visitor
  // scrolling (wheelRun) is dropped the same way: Lenis turns any wheel into
  // a scroll from where the page is, stopping the glide short.
  private lenisFilter = (data: LenisInput): boolean => {
    if (this.hostFilter && this.hostFilter(data) === false) return false;
    const lenis = this.restLenis;
    if (!lenis || data.event.type !== 'wheel') return true;
    const now = performance.now();
    this.push = edgePush(this.push, data.deltaY, lenis.targetScroll, lenis.limit, now);
    if (!this.push) {
      if (now >= this.lenisGlideUntil) return true;
      if (this.wheelTakesOver(data.deltaY)) {
        this.lenisGlideUntil = 0;
        return true;
      }
    }
    if (data.event.cancelable) data.event.preventDefault();
    return false;
  };

  private wheelTakesOver(delta: number): boolean {
    this.wheelTravel = wheelRun(this.wheelTravel, delta, performance.now());
    return this.wheelTravel.px >= WHEEL_TAKEOVER_PX;
  }

  private onLenisScroll = () => {
    if (this.lenis?.isScrolling === 'native' && !atPageEdge(window.scrollY, this.pageMax())) this.watchRest();
  };

  // Without Lenis: a scroll event during the player's own glide is the glide.
  private onNativeScroll = () => {
    this.seenY = window.scrollY;
    if (!this.glideNow && !atPageEdge(this.seenY, this.pageMax())) this.watchRest();
  };

  // Without Lenis: a wheel pushing against a page edge is not scrolling. Judged
  // by where the page was before this wheel (seenY): the browser may already
  // have scrolled the page by it when this passive listener runs, and the
  // stroke that carries the page to the top must still count. The browser
  // keeps control of the momentum (Chrome makes the rest of a gesture
  // uncancelable once its first event was not prevented), so settle waits
  // for the push to end instead of gliding under it.
  private onNativeWheel = (e: WheelEvent) => {
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
    this.push = edgePush(this.push, delta, this.seenY, this.pageMax(), performance.now());
    if (this.push) return;
    // A stray event during a glide is not the visitor taking over (wheelRun).
    if (this.glideNow && !this.wheelTakesOver(delta)) return;
    this.onNativeInput();
  };

  // Without Lenis: a wheel, finger or scroll key takes over from a glide at
  // once (onGlideScroll would notice a frame later) and counts as scrolling.
  private onNativeInput = () => {
    this.stopGlide();
    this.watchRest();
  };

  // The page does not scroll while the loading screen fills the screen, so a
  // wheel, swipe or key there cannot skip the intro or land the visitor
  // somewhere they never saw (owner).
  // Cancelled at the window in the capture phase, ahead of Lenis's own
  // listeners. Not lenis.stop(): its overflow: clip hides a classic
  // scrollbar, so the page width would shift on and off.
  private freezeScroll(on: boolean) {
    if (on === this.frozen) return;
    this.frozen = on;
    window.clearTimeout(this.freezeTimer);
    const o: AddEventListenerOptions = { capture: true, passive: false };
    if (on) {
      window.addEventListener('wheel', this.cancelScroll, o);
      window.addEventListener('touchmove', this.cancelScroll, o);
      window.addEventListener('keydown', this.cancelScrollKey, o);
      this.freezeTimer = window.setTimeout(() => this.freezeScroll(false), FREEZE_CAP_MS);
    } else {
      window.removeEventListener('wheel', this.cancelScroll, o);
      window.removeEventListener('touchmove', this.cancelScroll, o);
      window.removeEventListener('keydown', this.cancelScrollKey, o);
    }
  }

  // Only while the track fills the screen, so the loading screen is what the
  // visitor sees: content above or below the player is the host page's and
  // scrolls.
  private cancelScroll = (e: Event) => {
    // A box: while it is pinned.
    const r = this.track.getBoundingClientRect();
    const h = this.boxed ? this.stage.offsetHeight : window.innerHeight;
    if (r.top > this.stageTop + 1 || r.bottom < this.stageTop + h - 1) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  };

  // Space on a focused button presses it; that stays.
  private cancelScrollKey = (e: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(e.key)) return;
    if ((e.target as Element | null)?.closest?.('button, input, textarea, select, [contenteditable]')) return;
    this.cancelScroll(e);
  };

  private onNativeKey = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) this.onNativeInput();
  };

  private settle = () => {
    // A finger still on the screen is not done scrolling; touchend asks again.
    if (!this.ready || this.introPending || this.opening || this.touching || this.glideNow || !this.stopList.length) return;
    // Wait out a phone's bounce past the top or bottom (a glide started
    // inside it fights the bounce), and, without Lenis, wheel momentum still
    // pushing against an edge (onNativeWheel). Both end on their own; the
    // bounce is waited for a second at most, in case a page misreports its
    // height (a push ends PUSH_GAP_MS after its last event).
    const now = performance.now();
    const pos = window.scrollY;
    const pushing = !this.lenis && !!this.push && now - this.push.at < PUSH_GAP_MS;
    const bouncing = pos < 0 || pos > this.pageMax() + 1;
    if (bouncing) this.settleWaitAt ||= now;
    if (pushing || (bouncing && now - this.settleWaitAt < 1000)) {
      window.clearTimeout(this.restTimer);
      this.restTimer = window.setTimeout(this.settle, 50);
      return;
    }
    this.settleWaitAt = 0;
    // Where the scroll is heading, not where it is: Lenis may still be easing
    // out the last wheel notch.
    const from = this.lenis ? this.lenis.targetScroll : window.scrollY;
    const y = settleTarget(this.layout, this.stopList, {
      ...this.reachOf,
      to: from,
      top: this.scrollRange()[0],
      span: this.scrollRange()[1],
      snap: this.snapOn,
      returnFirst: this.returnFirst,
    });
    if (y === null) return;
    // The return to the first stop from above it replays the opening fly-in:
    // the intro's pace for the frames it crosses (introSeconds) and its ease,
    // whatever `glide` says.
    const [top, span] = this.scrollRange();
    const firstY = top + clamp01(this.stopScroll[0]) * span;
    if (this.returnFirst && from < firstY - 1 && Math.abs(y - firstY) <= 1) {
      const fromFlight = flightAt(this.layout, clamp01((from - top) / span));
      const frames = Math.round(Math.abs(this.stopList[0].at - fromFlight) * ((this.manifest?.frames ?? 1) - 1));
      this.glideTo(y, introSeconds(frames, this.manifest?.fps || 24), easeOutSine);
      return;
    }
    // 1.1 s however far by default; glide="scaled" times it by the distance
    // (settleSeconds in math.ts).
    this.glideTo(y, settleSeconds(y - from, this.lvh(), this.scaledGlide), easeInOutCubic);
  };

  private onTouch = (e: TouchEvent) => {
    this.touching = e.touches.length > 0;
    if (this.touching) this.stopGlide();
    else this.watchRest();
  };

  // Every glide the player makes (intro, label tap, settle) goes through
  // here: lenis.scrollTo with Lenis, else GSAP's ScrollToPlugin. Either way a
  // wheel, swipe or key takes over (lock: false; without Lenis the rest
  // rule's listeners and onGlideScroll, not autoKill: see isGlideEcho).
  private glideTo(y: number, duration: number, ease: (t: number) => number) {
    this.wheelTravel = null;
    if (this.lenis) {
      const until = performance.now() + duration * 1000;
      this.lenisGlideUntil = until;
      this.lenis.scrollTo(y, {
        duration,
        easing: ease,
        lock: false,
        onComplete: () => {
          if (this.lenisGlideUntil === until) this.lenisGlideUntil = 0;
        },
      });
      return;
    }
    this.stopGlide();
    let from = window.scrollY;
    this.glideTrail = [from];
    const glide = engine.glide(y, duration, ease, {
      // The plugin reads its start in the same render, just before this.
      start: () => {
        from = window.scrollY;
      },
      // Where the plugin put the page this frame (it interpolates on the
      // eased progress, unrounded) and where the browser says it is (clamped
      // at the page's ends).
      update: (progress) => {
        const trail = this.glideTrail;
        trail.push(from + (y - from) * ease(progress), window.scrollY);
        if (trail.length > 2 * GLIDE_ECHO_FRAMES) trail.splice(0, 2);
      },
      complete: () => {
        if (this.glideNow === glide) this.endGlide();
      },
    });
    // An engine with no glide (flythrough/no-gsap) and no Lenis: a cut. The
    // rest rule is not set up then (setupRest), so this is a label tap,
    // goToStop or the intro.
    if (!glide) {
      noGlide();
      this.cutTo(y);
      return;
    }
    this.glideNow = glide;
    window.addEventListener('scroll', this.onGlideScroll, { passive: true });
  }

  // Without Lenis: the page somewhere the glide did not put it takes over
  // (isGlideEcho), and the rest rule decides again, as autoKill did.
  private onGlideScroll = () => {
    if (!this.glideNow || isGlideEcho(window.scrollY, this.glideTrail)) return;
    this.stopGlide();
    this.watchRest();
  };

  private stopGlide() {
    if (!this.glideNow) return;
    this.glideNow.kill();
    this.endGlide();
  }

  private endGlide() {
    this.glideNow = undefined;
    window.removeEventListener('scroll', this.onGlideScroll);
  }

  // The track's length follows the screen height: the large viewport's
  // (lvh()), which a phone's address bar showing or hiding does not change, so
  // the track is not re-laid mid-swipe. A real change (rotation, a resized
  // window) keeps the visitor's place in the flight, not their pixel offset.
  // The place in the track when the window last resized, before the browser
  // clamps the scroll to the new page height and ScrollTrigger reads that
  // back into scrollPos (ResizeObserver, and so layoutTrack, run later).
  private placeAtResize: number | null = null;
  private onResize = () => {
    if (this.placeAtResize === null) this.placeAtResize = this.scrollPos;
  };
  // was: the layout before a live change of stops or pacing (applyChanges);
  // the track is laid out again even at the same height.
  private layoutTrack(was?: Layout) {
    if (!this.manifest) return;
    const vh = this.lvh();
    const place = this.placeAtResize ?? this.scrollPos;
    this.placeAtResize = null;
    // Without legs a hold's share of the track follows the flight's length in
    // screens, so the layout is made again for this screen height.
    const layout =
      this.legsGiven || !this.holdGiven
        ? this.layout
        : createLayout(this.stopList, null, this.holdGiven, flightScreens(this.manifest.frames, this.pxPerFrame, vh));
    // A box that came or went with the screen's size (a media query).
    if (this.readBox() && this.st) this.createTrigger();
    const h = trackHeight(layout, this.manifest.frames, this.pxPerFrame, vh, this.stageH());
    const px = `${Math.round(h)}px`;
    this.activeDist = reachShare(this.reachGiven, vh, Math.round(h) - this.stageH());
    if (this.track.style.height !== px || was) {
      const [top, span] = this.scrollRange();
      const y = this.scrollNow();
      const keep = this.booted && y >= top && y <= top + span ? remapPlace(was ?? this.layout, layout, place) : null;
      // The whole track above the screen: the visitor is reading what is
      // below the player, and stays on it when the track changes height
      // (a player that waited as one screen getting its track). A browser
      // that anchors the scroll does this itself, but not through Lenis,
      // which then pulled the page back by the track's height; Safari does
      // not anchor.
      const pageY = window.scrollY;
      const tall = this.track.getBoundingClientRect().bottom <= 0 ? this.track.offsetHeight : 0;
      this.layout = layout;
      this.track.style.height = px;
      engine.refresh();
      this.lenis?.resize();
      if (keep !== null) {
        this.stopGlide();
        this.jumpTo(keep);
      } else if (tall) {
        const to = pageY + this.track.offsetHeight - tall;
        // Lenis drops a cut to where its target already is, and resize()
        // has just put it there (the browser anchored the scroll). A glide
        // of Lenis's own still under way (the visitor's last wheel) is not
        // ended by resize() and would carry the page back by the track's
        // height: a step aside first makes the cut real, which ends it.
        if (this.lenis) this.cutTo(to - 1);
        this.cutTo(to);
      }
    }
  }

  private sizeCanvas() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cw = Math.round(w * this.dpr);
    let ch = Math.round(h * this.dpr);
    // Never more pixels than the footage has. A sharp screen asks for a canvas
    // several times the frame's size, every pixel of it filled twice a frame
    // when blending, for no added detail: CSS enlarges a frame-sized canvas to
    // the same picture.
    if (this.set) {
      const fit = this.fitTo === 'cover' ? Math.max : Math.min;
      const enlarge = fit(cw / this.set.width, ch / this.set.height);
      if (enlarge > 1) {
        cw = Math.round(cw / enlarge);
        ch = Math.round(ch / enlarge);
      }
    }
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.needsRedraw = true;
      // Now, not on the next frame: resizing cleared the canvas, and a frame
      // painted in between shows black (on a phone, every time the address
      // bar shows or hides).
      this.draw();
    }
  }

  // ---------------------------------------------------------------- loading

  private startLoading() {
    const n = this.manifest!.frames;
    const start = Math.round(this.startProgress * (n - 1));
    // The intro plays 0..start straight away, so all of it, in playing order.
    this.readyQueue = readyOrder(n, start, this.introPending, this.manifest!.fps);
    this.readySet = new Uint8Array(n);
    for (const i of this.readyQueue) this.readySet[i] = 1;
    this.readyTotal = this.readyQueue.length;
    this.countOn();
    this.pump();
  }

  private countOn() {
    if (this.countRaf || this.shownShare >= 1 || !this.loadNum?.isConnected) return;
    this.countAt = performance.now();
    this.countRaf = requestAnimationFrame(this.count);
  }

  // One step of the loading number (see COUNT_EASE_MS). Runs every animation
  // frame while the loading screen is up, and stops at 100.
  private count = (now: number) => {
    this.countRaf = 0;
    if (!this.loadNum?.isConnected) return;
    if (this.ready) {
      const t = this.liftMs > 0 ? clamp01((now - this.liftAt) / this.liftMs) : 1;
      this.shownShare = this.liftFrom + (1 - this.liftFrom) * t;
    } else {
      const gap = this.readyShare - this.realShown;
      // At most two screen frames' worth per step: after a long frame (the
      // browser busy with arriving images) the number keeps its pace instead
      // of jumping the whole pause at once.
      const dt = Math.min(34, Math.max(0, now - this.countAt));
      const step = gap * (1 - Math.exp(-dt / COUNT_EASE_MS));
      this.realShown = gap < 0.002 ? this.readyShare : Math.min(this.readyShare, this.realShown + step);
      // holdLoading: a time keeps the number to the clock, so a quick load
      // counts up evenly over it; a pending promise keeps it short of 100.
      // The clock lift() goes by, not the frame's own time: this runs late
      // in a busy frame (60 ms with the processor slowed six times), and
      // the number then stood up to 3 behind the time it was written at.
      let share = this.realShown;
      if (this.holdMs) share = Math.min(share, clamp01((performance.now() - this.veilAt) / this.holdMs), 0.999);
      if (this.heldBy) share = Math.min(share, 0.999);
      this.shownShare = share;
    }
    this.countAt = now;
    // Floored, so the number shown is never ahead of what is loaded.
    const text = String(Math.floor(this.shownShare * 100 + 1e-6));
    if (this.loadNum.textContent !== text) this.loadNum.textContent = text;
    if (this.shownShare < 1) this.countRaf = requestAnimationFrame(this.count);
  };

  // How long the loading screen takes to fade: its own opacity transition, so
  // the stylesheet's --ft-loading-fade (or a host's own transition on
  // .ft__loading) decides when the screen is removed and the intro starts.
  private veilMs(): number {
    const el = this.loadingEl;
    if (!el?.isConnected) return 0;
    const cs = getComputedStyle(el);
    const list = (v: string) => v.split(',').map((x) => x.trim());
    const ms = (v: string) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000) || 0;
    const props = list(cs.transitionProperty);
    const k = props.findIndex((p) => p === 'opacity' || p === 'all');
    if (k < 0) return 0;
    const dur = list(cs.transitionDuration);
    const delay = list(cs.transitionDelay);
    return ms(dur[k % dur.length]) + ms(delay[k % delay.length]);
  }

  // CONCURRENT frames in flight at a time, each finished one asking for the next.
  private pump() {
    this.watchStall();
    const gen = this.loadGen;
    const next = () => {
      if (gen !== this.loadGen) return;
      const i = this.pickNext();
      if (i >= 0) this.loadFrame(i, next);
    };
    for (let k = 0; k < CONCURRENT; k++) next();
  }

  // Armed again by every frame that lands while the loading screen is up.
  // When none has for STALL_MS (a host that stopped answering): with no
  // frame in at all the player gives up (fail); else the screen lifts on
  // what is in, and what is missing is still asked for. Only for frames
  // still expected: with every frame in or given up on for good, the screen
  // is up for a host's hold (holdLoading) and nothing is missing.
  private watchStall() {
    window.clearTimeout(this.stallTimer);
    if (this.ready || this.gaveUp) return;
    const gen = this.loadGen;
    this.stallTimer = window.setTimeout(() => {
      if (gen !== this.loadGen || this.ready || this.gaveUp) return;
      if (this.loadedCount + this.failedCount >= this.loaded.length) return;
      if (!this.loadedCount) return this.fail(new Error(`flythrough: no frame arrived in ${STALL_MS / 1000} s (${frameUrl(this.base, this.set!, 1)} and others)`));
      console.warn('flythrough: frames stopped arriving; the loading screen lifts on what is in');
      this.stalled = this.liftWaitOver = true;
      this.checkReady();
    }, STALL_MS);
  }

  // After the ready set: whatever is nearest the visitor, ahead first, so the
  // stretch they are about to scroll through is always the next to arrive.
  private pickNext(): number {
    while (this.readyQueue.length) {
      const i = this.readyQueue.shift()!;
      if (!this.loaded[i] && !this.inFlight[i]) return i;
    }
    const n = this.loaded.length;
    const free = (i: number) => i >= 0 && i < n && !this.loaded[i] && !this.inFlight[i] && !this.failed[i];
    for (let d = 0; d <= 96; d++) if (free(this.frame + d)) return this.frame + d;
    for (let d = 1; d <= 48; d++) if (free(this.frame - d)) return this.frame - d;
    for (let i = 0; i < n; i++) if (free(i)) return i;
    return -1;
  }

  // fetch, not <img>: the bytes are kept and decoded off the main thread
  // (warmDecode), and frames still in flight do not hold back the page's load
  // event (an <img> does, so the tab's spinner ran until every frame was in).
  // The ready set asks with high priority, the rest with low, behind the
  // host page's own requests.
  private loadFrame(i: number, done: () => void) {
    this.inFlight[i] = 1;
    if (this.useImg) return this.loadImg(i, done);
    const url = frameUrl(this.base, this.set!, i + 1);
    const init = { credentials: 'same-origin', priority: this.ready ? 'low' : 'high' } as RequestInit;
    fetch(url, init)
      .then((res) => {
        if (res.ok) return res.blob();
        // The file is not there (404, 403, 410 ...): asking again will not help.
        const gone = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        throw gone ? 'gone' : 'again';
      })
      .then(
        (blob) => {
          this.blobs[i] = blob;
          this.landed(i, done);
        },
        (why) => {
          // From another origin, a TypeError may be a host that sends no CORS
          // header: fetch cannot read that, an <img> can. If the img loads,
          // every frame from here on is an img. From this origin it is the
          // network, and the frame is asked again as fetch.
          if (why instanceof TypeError && this.crossOrigin) return this.loadImg(i, done, true);
          this.missed(i, done, why === 'gone');
        },
      );
  }

  // probe: the fallback test after a fetch TypeError; success switches to imgs.
  private loadImg(i: number, done: () => void, probe = false) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (probe && !this.useImg) {
        this.useImg = true;
        console.info('flythrough: frames cannot be fetched (no CORS?); drawing them as images');
      }
      this.imgs[i] = img;
      this.landed(i, done);
    };
    img.onerror = () => this.missed(i, done, false);
    img.src = frameUrl(this.base, this.set!, i + 1);
  }

  private landed(i: number, done: () => void) {
    if (this.gaveUp) return;
    this.inFlight[i] = 0;
    this.loaded[i] = 1;
    this.loadedCount++;
    // Near the current frame: draw() starts its decode (warmDecode) and shows it.
    if (Math.abs(i - this.frame) <= AHEAD) this.scheduleDraw();
    if (!this.ready) {
      this.watchStall();
      this.checkReady();
    }
    if (this.loadedCount === this.loaded.length) this.setAttribute('loaded', '');
    done();
  }

  private missed(i: number, done: () => void, gone: boolean) {
    if (this.gaveUp) return;
    // Still in flight while it waits, so pickNext leaves it alone.
    const gen = this.loadGen;
    const again = () => (gen === this.loadGen ? this.loadFrame(i, done) : (this.inFlight[i] = 0));
    // The device is offline: not the frame's fault, so it does not use up
    // its tries (a drop of a few seconds once left two dozen frames missing
    // for good). Asked again when the connection is back.
    if (!gone && navigator.onLine === false) return window.addEventListener('online', again, { once: true });
    const wait = gone ? undefined : RETRY_MS[this.tries[i]++];
    if (wait !== undefined) {
      window.setTimeout(again, wait);
      return;
    }
    this.inFlight[i] = 0;
    this.failed[i] = 1;
    this.failedCount++;
    if (!this.loadedCount && this.failedCount >= Math.min(GIVE_UP_AFTER, this.readyTotal || GIVE_UP_AFTER)) {
      return this.fail(new Error(`flythrough: no frame could be loaded from ${this.base} (${frameUrl(this.base, this.set!, i + 1)} and others)`));
    }
    if (!this.ready) this.checkReady();
    done();
  }

  private checkReady() {
    // Count only the ready set, so the number reaches 100 as the screen lifts.
    // A frame given up on counts as done.
    let have = 0;
    let lost = 0;
    const n = this.loaded.length;
    const first = this.openingFrame();
    for (let i = 0; i < n; i++) {
      if (!this.readySet[i]) continue;
      if (this.loaded[i]) have++;
      else if (this.failed[i]) lost++;
    }
    have += lost;
    const pct = this.readyTotal ? Math.min(1, have / this.readyTotal) : 0;
    const barFill = this.loadingEl?.querySelector<HTMLElement>('i');
    if (barFill) barFill.style.transform = `scaleX(${pct})`;
    this.readyShare = pct; // the number follows it in count()
    if (this.loaded[first] && this.drawn < 0) this.scheduleDraw();
    if (have < this.readyTotal && !this.stalled) return;
    if (!this.liftWaiting && lost) console.warn(`flythrough: ${lost} frames failed to load`);
    if (this.drawn >= 0 || this.liftWaitOver) return this.lift();
    // The veil lifts onto a picture: wait for the start frame to be drawn
    // (draw() calls lift), LIFT_WAIT_MS at most.
    if (this.liftWaiting) return;
    this.liftWaiting = true;
    this.scheduleDraw();
    const gen = this.loadGen;
    window.setTimeout(() => {
      if (gen !== this.loadGen) return;
      this.liftWaitOver = true;
      this.lift();
    }, LIFT_WAIT_MS);
  }

  private lift() {
    if (this.ready || this.gaveUp) return;
    // holdLoading: a promise still pending asks again when it settles
    // (checkReady); a time not yet passed asks again then. Whatever called
    // lift (the ready set in, the start frame drawn, the LIFT_WAIT_MS cap) is
    // covered either way.
    if (this.heldBy) return;
    const wait = this.veilAt + this.holdMs - performance.now();
    if (wait > 0) {
      if (!this.minTimer) {
        const gen = this.loadGen;
        this.minTimer = window.setTimeout(() => {
          this.minTimer = 0;
          if (gen === this.loadGen) this.lift();
        }, wait);
      }
      return;
    }
    this.liftWaiting = false;
    this.ready = true;
    this.freezeScroll(false);
    // Behind the loading screen the picture held the opening frame (draw).
    // Now the place the scroll is at (moved only from outside the track, or
    // after FREEZE_CAP_MS); on the LIFT_WAIT_MS cap the nearest decoded frame
    // stands in.
    this.needsRedraw = true;
    this.scheduleDraw();
    this.setAttribute('ready', '');
    this.loadingEl?.classList.add('ft__loading--done');
    const veil = this.veilMs();
    this.liftAt = performance.now();
    this.liftFrom = this.shownShare;
    this.liftMs = Math.min(COUNT_FINISH_MS, veil * 0.4);
    this.countOn();
    window.setTimeout(() => this.loadingEl?.remove(), veil + 50);
    this.say('flythrough-ready');
    // Moved while the frames loaded (host content above or below scrolls,
    // and the hold ends at FREEZE_CAP_MS): the visitor has taken over, so
    // the intro does not play; the rest rule decides instead.
    const moved = Math.abs(this.scrollNow() - this.openY) > 2;
    if (moved) this.introPending = false;
    if (this.introPending) this.playIntro(veil);
    else {
      this.updateStops(true);
      // Opened part way up the opening leg (a position set before boot), or
      // moved while loading: the rest rule is asked once. Not with
      // autoscroll="off" and nothing moved: the page stays where it opened
      // until the visitor scrolls.
      if (this.restVia && (moved || !this.isOff('autoscroll'))) this.watchRest();
    }
    this.warnStyle();
  }

  // Without the stylesheet nothing is laid out (the element itself stays
  // inline). Asked once the player is ready: a stylesheet a script adds has
  // arrived by then.
  private warnStyle() {
    if (getComputedStyle(this).display === 'inline') console.warn("flythrough: the stylesheet is missing: import 'flythrough/style.css'");
  }

  // The opening: as the loading screen lifts, scroll from frame 0 to the first
  // stop through the libraries' own scrollTo, so it is ordinary scrolling the
  // visitor can take over with a wheel, swipe or key. Close to the footage's
  // own speed (slower reads as stutter), easing out onto the stop. The first
  // overlay is not timed: it appears where the scroll crosses its approach
  // point (stopLow), the same place as when the visitor scrolls there by hand,
  // only with a slower fade the first time.
  // veil: how long the loading screen takes to fade (veilMs).
  private playIntro(veil: number) {
    this.introPending = false;
    this.opening = true;
    const frames = Math.round(this.startProgress * ((this.manifest?.frames ?? 1) - 1));
    const duration = introSeconds(frames, this.manifest?.fps || 24);
    // Not before the loading veil is gone: it blurs what is behind it, and
    // re-blurring a full screen of moving picture every frame made the first
    // half second of the glide stutter, worst on phones.
    this.introTimer = window.setTimeout(() => {
      const y = this.yFor(this.stopScroll[0]);
      this.setAttribute('intro-reveal', '');
      window.setTimeout(() => this.removeAttribute('intro-reveal'), duration * 1000 + 1600);
      this.opening = false;
      window.clearTimeout(this.restTimer);
      this.glideTo(y, duration, easeOutSine);
    }, veil + 80);
  }

  // What draw() lays on the canvas for frame j: its bitmap, else its img.
  private pic(j: number): ImageBitmap | HTMLImageElement | undefined {
    return this.bitmaps[j] ?? this.imgs[j];
  }

  private nearestDrawable(target: number): number {
    if (this.pic(target)) return target;
    const n = this.loaded.length;
    for (let d = 1; d < n; d++) {
      if (target - d >= 0 && this.pic(target - d)) return target - d;
      if (target + d < n && this.pic(target + d)) return target + d;
    }
    return -1;
  }

  // Keeps the frames around the current one decoded, so drawing never waits on
  // a decode. The window leans the way the flight is moving (AHEAD in front,
  // BEHIND at the back; IDLE either side when still): a label glide passes two
  // or more frames per draw, and the ones behind are not coming back soon.
  // Blobs: createImageBitmap decodes off the main thread; bitmaps outside the
  // window (plus SLACK) are closed, so memory holds about thirty decoded
  // frames, never the whole flight. Starting a decode and closing a bitmap
  // each cost the main thread about 0.2 ms on a slow phone, so a call starts
  // at most MAX_STARTS (nearest first, ahead before behind) and closes at most
  // MAX_CLOSES (the rest on later calls, within HOLD_MAX); and at speed only
  // every step-th frame is decoded (step: half the frames passed per draw),
  // since the others fly past unseen and draw() shows the nearest decoded
  // one. The frames on the canvas are kept until others are drawn: a canvas
  // resize redraws them at once (sizeCanvas).
  // Imgs: img.decode() for frames new to the window; a frame that left and
  // came back is asked again, since the browser may have dropped its pixels.
  private warmDecode() {
    const n = this.loaded.length;
    // Behind the loading screen the picture is the opening frame (draw),
    // wherever the page is by now: a player that does not hold the page can
    // be scrolled through while it loads. -1 once the screen has lifted.
    const first = this.ready ? -1 : this.openingFrame();
    const moved = this.frame - this.warmAt;
    const dir = Math.sign(moved);
    this.warmAt = this.frame;
    const lo = Math.max(0, this.frame - (dir > 0 ? BEHIND : dir < 0 ? AHEAD : IDLE));
    const hi = Math.min(n - 1, this.frame + (dir > 0 ? AHEAD : dir < 0 ? BEHIND : IDLE));
    const step = Math.max(1, Math.round(Math.abs(moved) / 2));
    const gen = this.loadGen;
    const fwd = dir < 0 ? -1 : 1;
    let starts = 0;
    for (let d = 0; d <= hi - lo; d++) {
      for (const j of d ? [this.frame + fwd * d, this.frame - fwd * d] : first < 0 || first === this.frame ? [this.frame] : [this.frame, first]) {
        if ((j < lo || j > hi) && j !== first) continue;
        const blob = this.blobs[j];
        if (blob) {
          if (this.bitmaps[j] || this.decoding[j] || this.undecodable[j]) continue;
          if (starts >= MAX_STARTS || this.decodingCount >= MAX_DECODING || (d > 1 && j % step)) continue;
          starts++;
          this.decoding[j] = 1;
          this.decodingCount++;
          createImageBitmap(blob).then(
            (bm) => {
              this.decoding[j] = 0;
              this.decodingCount--;
              if (gen !== this.loadGen || ((j < this.warmLo - SLACK || j > this.warmHi + SLACK) && (this.ready || j !== this.openingFrame()))) return bm.close();
              this.bitmaps[j] = bm;
              this.held.add(j);
              // Closer to the wanted frame than what is shown, or half of a cross-fade.
              if (this.drawn < 0 || Math.abs(j - this.framePos) <= Math.abs(this.drawn - this.framePos) + 1) this.scheduleDraw();
            },
            () => {
              this.decoding[j] = 0;
              this.decodingCount--;
              this.undecodable[j] = 1;
            },
          );
          continue;
        }
        const img = this.imgs[j];
        if (!img) continue;
        if (this.decodedAt[j] >= 0 && j >= this.warmLo && j <= this.warmHi) continue;
        this.decodedAt[j] = this.frame;
        img.decode().catch(() => {});
      }
    }
    this.warmLo = lo;
    this.warmHi = hi;
    // At most MAX_CLOSES, unless more are held (or on their way) than
    // HOLD_MAX: then as many as it takes, so jumps (more starts than closes
    // per call) never pile up.
    const due = Math.max(MAX_CLOSES, this.held.size + this.decodingCount - HOLD_MAX);
    let closes = 0;
    for (const j of this.held) {
      if ((j >= lo - SLACK && j <= hi + SLACK) || j === this.shownA || j === this.shownB || j === first) continue;
      if (++closes > due) break;
      this.bitmaps[j]!.close();
      this.bitmaps[j] = undefined;
      this.held.delete(j);
    }
  }

  // ---------------------------------------------------------------- progress

  // sp: scroll position (0..1 of the track); the flight position follows from the knots.
  private setProgress(sp: number) {
    sp = clamp01(sp);
    if (sp === this.scrollPos && this.drawn >= 0) return;
    this.scrollPos = sp;
    const p = flightAt(this.layout, sp);
    this.progress = p;
    const n = this.manifest?.frames ?? 1;
    this.framePos = p * (n - 1);
    this.frame = Math.round(this.framePos);
    this.stillAt = 0;
    // To four places: steps too small to see, and no write when the flight
    // has not moved.
    const share = String(Math.round(p * 1e4) / 1e4);
    if (share !== this.shareSet) {
      this.shareSet = share;
      for (const el of this.shareEls) el.style.setProperty('--ft-progress', share);
    }
    // Drawn now, not through scheduleDraw: this already runs inside an
    // animation frame (GSAP's ticker), and a requestAnimationFrame made from
    // one lands a frame later, behind the next update, which then finds a
    // draw "already scheduled" and is skipped. That halved the picture to 30
    // draws a second and put it two frames behind the scroll.
    this.draw();
    this.updateStops();
    this.updateMoments();
    this.updateBar();
  }

  // For redraws that do not come from scrolling (a frame arriving, a resize):
  // many can land together, so they share one animation frame.
  private scheduleDraw() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  // STILL_MS after the flight last moved while two frames were mixed.
  private still = () => {
    this.stillAt = performance.now();
    this.scheduleDraw();
  };

  // Between two drawable frames the later one is laid over the earlier at the
  // fraction scrolled between them, so slow scrolling and the intro glide
  // move smoothly instead of stepping 24 times a second. Not when the flight
  // moved a frame or more since the last draw (a fast scroll, a label glide):
  // the fade is not seen at that speed, and with imgs it cost a second decode
  // per picture (a slow phone fell from 38 to 23 pictures a second). Only
  // while the page moves: a scroll left between two frames would rest on a
  // doubled picture, so once the flight is still (still) the fraction runs
  // out to the nearer frame over UNBLEND_MS (owner).
  private draw() {
    if (!this.set || !this.loaded.length) return;
    this.warmDecode();
    // Behind the loading screen only the opening frame itself, whatever the
    // scroll does, so the picture there changes once: a stand-in, or frames
    // arriving under a visitor scrolling, read as a flicker on a phone.
    const held = !this.ready;
    const want = held ? this.openingFrame() : this.frame;
    if (held && !this.pic(want)) return;
    const i = held ? want : this.nearestDrawable(want);
    if (i < 0) return;
    const a = Math.floor(this.framePos);
    let t = this.framePos - a;
    if (this.stillAt) {
      const k = clamp01((performance.now() - this.stillAt) / UNBLEND_MS);
      t += (Math.round(t) - t) * k;
      if (k < 1) this.scheduleDraw();
    }
    const slow = Math.abs(this.framePos - this.drawnPos) < 1;
    const blend = !held && slow && t > 0.04 && t < 0.96 && !!this.pic(a) && !!this.pic(a + 1);
    if (blend && !this.stillAt) {
      window.clearTimeout(this.stillTimer);
      this.stillTimer = window.setTimeout(this.still, STILL_MS);
    }
    const key = blend ? a + Math.round(t * 16) / 16 : i;
    if (key === this.drawnKey && !this.needsRedraw) return;
    const under = this.pic(blend ? a : i)!;
    const { width: cw, height: ch } = this.canvas;
    const fw = (under instanceof HTMLImageElement ? under.naturalWidth : under.width) || this.set.width;
    const fh = (under instanceof HTMLImageElement ? under.naturalHeight : under.height) || this.set.height;
    // focus = where the subject sits in the frame; centre the crop on it, never
    // past an edge. A pre-cropped set is already centred on it.
    const at = held ? i / Math.max(1, this.loaded.length - 1) : this.progress;
    const [fx, fy] = this.set.cropped ? [0.5, 0.5] : focusAt(this.stopList, at);
    const scale = this.fitTo === 'cover' ? Math.max(cw / fw, ch / fh) : Math.min(cw / fw, ch / fh);
    const dw = fw * scale;
    const dh = fh * scale;
    const place = (view: number, size: number, f: number) =>
      size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, view / 2 - f * size));
    const ox = place(cw, dw, fx);
    const oy = place(ch, dh, fy);
    if (this.fitTo === 'contain') {
      this.ctx.fillStyle = getComputedStyle(this).getPropertyValue('--ft-bg') || '#000';
      this.ctx.fillRect(0, 0, cw, ch);
    }
    this.ctx.drawImage(under, ox, oy, dw, dh);
    if (blend) {
      this.ctx.globalAlpha = t;
      this.ctx.drawImage(this.pic(a + 1)!, ox, oy, dw, dh);
      this.ctx.globalAlpha = 1;
    }
    this.drawn = i;
    if (this.posterEl) {
      this.posterEl.remove();
      this.posterEl = null;
    }
    this.shownA = blend ? a : i;
    this.shownB = blend ? a + 1 : -1;
    this.drawnKey = key;
    this.drawnPos = this.framePos;
    this.needsRedraw = false;
    if (this.liftWaiting) queueMicrotask(() => this.lift());
    // Not for the picture settling at rest: nothing the event says changed.
    if (!this.stillAt) this.say('flythrough-progress', { progress: this.progress, position: this.scrollPos, frame: this.frame + 1 });
  }

  // The player's events all bubble.
  private say(name: string, detail?: ProgressDetail | StopDetail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  private updateStops(force = false) {
    if (!this.ready && !force) return;
    const k = stopShowingAt(this.layout, this.stopList, this.scrollPos, this.reachOf);
    const next = k < 0 ? null : this.stopList[k].id;
    if (next === this.activeStop && !force) return;
    if (this.activeStop) {
      this.overlays.get(this.activeStop)?.removeAttribute('data-active');
      this.say('flythrough-stop', { id: this.activeStop, active: false });
    }
    this.activeStop = next;
    if (next) {
      this.overlays.get(next)?.setAttribute('data-active', '');
      this.say('flythrough-stop', { id: next, active: true });
    }
  }

  // --ft-moment is how far the flight is through the moment, 0 to 1, clamped
  // outside it, so a moment's contents can be scrubbed in CSS and run back on
  // scrolling up. Stills mode never sets it: CSS gives it a resting value.
  private updateMoments() {
    for (const m of this.moments) {
      const t = Math.round(clamp01((this.progress - m.from) / (m.to - m.from)) * 1000) / 1000;
      if (t !== m.t) {
        m.t = t;
        m.el.style.setProperty('--ft-moment', String(t));
      }
      const on = this.progress >= m.from && this.progress <= m.to;
      if (on === m.on) continue;
      m.on = on;
      m.el.toggleAttribute('data-active', on);
    }
  }

  private updateBar() {
    if (!this.barEl || !this.fill) return;
    const s = this.stopScroll;
    const x = this.scrollPos;
    this.fill.style.transform = `scaleX(${barFill(s, x)})`;
    const best = currentLabel(s, x, this.stopList.findIndex((st) => st.id === this.activeStop));
    // The Tab stop follows the current label, unless focus is in the labels:
    // then it stays where the arrow keys put it.
    const steer = !this.barEl.contains(document.activeElement);
    this.labels.forEach((b, i) => {
      if (i === best) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('ft__label--past', i < best || (i === best && x >= s[i]));
      if (steer && best >= 0) b.tabIndex = i === best ? 0 : -1;
    });
  }

  // ---------------------------------------------------------------- stops

  // The frame the loading screen covers: frame 0 with an intro to play, else
  // the frame the player opened on.
  private openingFrame(): number {
    return this.introPending ? 0 : Math.round(this.startProgress * (this.loaded.length - 1));
  }

  // Where the page scroll is heading: Lenis may still be easing.
  private scrollNow(): number {
    return this.lenis ? this.lenis.targetScroll : window.scrollY;
  }

  // Whether the host asks for a box, read from the element's style; true
  // when that changed. The stylesheet sizes the stage under [boxed], and
  // its sticky top is where the box pins.
  private readBox(): boolean {
    const was = this.boxed;
    this.boxed = this.boxNow();
    this.toggleAttribute('boxed', this.boxed);
    this.stageTop = this.boxed && this.stage ? parseFloat(getComputedStyle(this.stage).top) || 0 : 0;
    return this.boxed !== was;
  }

  // Whether the host asks for a box right now.
  private boxNow(): boolean {
    return !!getComputedStyle(this).getPropertyValue('--ft-stage-height').trim();
  }

  // The sticky stage's height in the track: the screen's (lvh()), or the box's.
  private stageH(): number {
    return this.boxed ? this.stage.offsetHeight : this.lvh();
  }

  // For pickSet: a box's own size in device pixels (el: something as wide as
  // the box, its height the host's); undefined full-screen, the window's.
  private boxSize(el: HTMLElement): { width: number; height: number } | undefined {
    if (!this.boxed) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--ft-stage-height)';
    el.append(probe);
    const height = probe.offsetHeight;
    probe.remove();
    return { width: el.clientWidth * dpr, height: height * dpr };
  }

  // Where the track's scroll starts and how far it runs, measured from the
  // page (scrollRange gives the engine's own reading once there is one).
  // Full-screen: from the track's top at the top of the screen, its height
  // less a screen. A box: from where it pins to where it lets go; a box
  // near the top of the page is pinned from the start, so its range begins
  // at 0 and is that much shorter.
  private rangeTop(): number {
    return this.boxed ? Math.max(0, this.trackTop() - this.stageTop) : this.trackTop();
  }
  private rangeSpan(): number {
    const cut = this.boxed ? Math.max(0, this.stageTop - this.trackTop()) : 0;
    return this.track.offsetHeight - this.stageH() - cut;
  }

  private trackTop(): number {
    return this.track.getBoundingClientRect().top + window.scrollY;
  }

  // A cut, not a glide: for opening the page at a position.
  private jumpTo(sp: number) {
    this.cutTo(this.yFor(sp));
    this.setProgress(sp);
  }

  // A cut to page y, through Lenis when the host has it. resize(): the
  // page may just have grown (the track, the stills); Lenis would clamp to
  // the height it last measured.
  private cutTo(y: number) {
    if (this.lenis) {
      this.lenis.resize();
      this.lenis.scrollTo(y, { immediate: true, force: true });
    } else window.scrollTo({ top: y, behavior: 'instant' });
  }

  // Page y where the track's scroll starts, and how far it runs: as
  // ScrollTrigger measured them at its last refresh, so a stop's position
  // always agrees with its frame.
  private scrollRange(): [number, number] {
    if (this.st) return [this.st.start, this.st.end - this.st.start];
    return [this.rangeTop(), Math.max(0, this.rangeSpan())];
  }

  // The viewport's height with a phone's address bar hidden (100lvh), which
  // does not change as the bar shows and hides. The visible height
  // (innerHeight, 100dvh) does, and sizing the track or the scroll range from
  // it made the whole tour re-measure, and the picture jump, every time the
  // bar moved. On a computer the two are the same.
  private lvh(): number {
    return this.probe?.offsetHeight || window.innerHeight;
  }

  // sp: scroll position (0..1 of the track).
  private yFor(sp: number): number {
    const [top, span] = this.scrollRange();
    return top + clamp01(sp) * span;
  }

  // A label tap flies there through the footage, never a cut: longer trips get
  // more time, capped at 3 s. A new wheel, touch or key interrupts it.
  // Ignored until the frames are in: the page is held still under the loading
  // screen. In stills mode it jumps to that stop's still (no motion).
  // i: the stop's number (from 0, in flight order) or its id.
  goToStop(i: number | string) {
    if (typeof i === 'string') i = this.stopList.findIndex((st) => st.id === i);
    const s = this.stopList[i];
    if (!s || !this.ready) return;
    if (this.kind === 'stills') {
      const still = Array.from(this.querySelectorAll<HTMLElement>('.ft__still')).find((el) => el.dataset.still === s.id);
      if (!still) return;
      this.cutTo(still.getBoundingClientRect().top + window.scrollY);
      return;
    }
    const at = this.stopScroll[i];
    const y = this.yFor(at);
    const duration = labelGlideSeconds(this.scrollPos, at);
    // A scroll that ended just before the tap must not settle mid-glide. The
    // glide itself never arms the rest rule; a visitor who interrupts it does.
    window.clearTimeout(this.restTimer);
    this.glideTo(y, duration, easeInOutCubic);
  }
}

// Each entry calls this with its engine: the first one on a page counts.
export function define(with_: Engine) {
  engine ??= with_;
  if (typeof customElements === 'undefined' || customElements.get('fly-through')) return;
  customElements.define('fly-through', Flythrough);
  // WebKit (bug 307920): an element copied out of a template with
  // importNode (Svelte's mount, Lit) before anything on the page had used
  // customElements has no registry, and neither define() nor upgrade() ever
  // reaches it. initialize() gives it this registry, in place. Elsewhere
  // nothing matches. test/examples-test.mjs: svelte, filled by the browser.
  const registry = customElements as CustomElementRegistry & { initialize?: (root: Node) => void };
  for (const el of document.querySelectorAll('fly-through:not(:defined)')) {
    registry.initialize?.(el);
    registry.upgrade(el);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fly-through': Flythrough;
  }
  // The events bubble, so they are typed where the element's, the
  // document's and the window's event maps all inherit them.
  interface GlobalEventHandlersEventMap {
    'flythrough-ready': CustomEvent<null>;
    'flythrough-progress': CustomEvent<ProgressDetail>;
    'flythrough-stop': CustomEvent<StopDetail>;
  }
}
