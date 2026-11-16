// What the player needs from outside itself: something that says how far the
// page has scrolled through its track, and something that glides the page.
// Two engines fill this in. gsap-engine.ts (the default entry,
// "flythrough"): GSAP's ScrollTrigger and ScrollToPlugin. native-engine.ts
// (entry "flythrough/no-gsap"): the browser's own scroll events, and no
// glide of its own, so there every glide goes through Lenis. The player
// (flythrough.ts) imports neither: an entry hands it one (define()).

// The scroll through one player's track. start and end are page scroll
// positions in px (the track's first and last), progress 0..1 between them.
export interface Tracker {
  readonly start: number;
  readonly end: number;
  readonly progress: number;
  kill(): void;
  // Read the scroll now (the native engine, for a Lenis frame: the browser's
  // own scroll event comes a frame after Lenis has moved the page).
  sync?(): void;
}

export interface TrackOptions {
  trigger: HTMLElement;
  // The page scroll position where the track starts, when it is not the
  // trigger's top reaching the top of the screen (a player in a box).
  start?: () => number;
  // How far the scroll runs through the track, px.
  span: () => number;
  // Called with the progress whenever it changes, and when it is measured
  // again (refresh).
  update: (progress: number) => void;
}

export interface GlideHooks {
  // Before the first step, once the glide has read where the page is.
  start(): void;
  // After each step: the glide's own progress, 0..1, before easing.
  update(progress: number): void;
  complete(): void;
}

export interface Engine {
  // Whether glide() glides. False: only Lenis does, and the player listens
  // to Lenis's frames for the scroll (Tracker.sync).
  readonly glides: boolean;
  // Once for each player as it joins the page.
  setup(): void;
  track(options: TrackOptions): Tracker;
  // Every track is measured again (a track changed its height).
  refresh(): void;
  // A glide of the window's scroll to y over `duration` seconds, or null
  // when the engine has none: then only Lenis glides.
  glide(y: number, duration: number, ease: (t: number) => number, on: GlideHooks): { kill(): void } | null;
}
