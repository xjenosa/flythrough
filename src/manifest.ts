// Shared by the player and the homepage prefetch: what a frame set is and
// which one a device should use. No DOM here beyond matchMedia and the
// window's size. Never imports gsap (package entry `flythrough/manifest`).
export interface FrameSet {
  width: number;
  height: number;
  pattern: string; // relative to the manifest, "{i}" is the frame number
  pad: number;
  // Pre-cropped around the stops' focus points by the frame maker, so the
  // player centres it instead of applying focus again.
  cropped?: boolean;
}

export interface Manifest {
  // The format's version: 1. Absent in manifests made before it was written,
  // which are the same format.
  version?: number;
  fps: number;
  duration: number;
  frames: number;
  sets: Record<string, FrameSet>;
}

// The newest manifest format this code reads (bin/frames.mjs writes it).
export const MANIFEST_VERSION = 1;

export async function loadManifest(url: string): Promise<Manifest> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch (err) {
    // The browser says no more than "Failed to fetch".
    throw new Error(`flythrough: manifest ${url} could not be fetched (${(err as Error)?.message}): no connection, or another domain that sends no CORS header`);
  }
  if (!res.ok) throw new Error(`flythrough: manifest ${url} ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // A dev server answers a path it does not know with its index page.
    throw new Error(`flythrough: manifest ${url} is not JSON (is the path right?)`);
  }
  return checkManifest(data, url);
}

// Throws, naming what is wrong, unless m is a manifest the player can use.
export function checkManifest(m: unknown, url = 'manifest'): Manifest {
  const bad = (why: string) => new Error(`flythrough: manifest ${url} ${why}`);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad('is not a manifest (expected an object)');
  const o = m as Record<string, unknown>;
  if (o.version !== undefined && o.version !== MANIFEST_VERSION) {
    throw bad(`has version ${String(o.version)}; this player reads version ${MANIFEST_VERSION}`);
  }
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!positive(o.frames) || !Number.isInteger(o.frames)) throw bad('needs "frames", a whole number above 0');
  if (!positive(o.fps)) throw bad('needs "fps", a number above 0');
  const sets = o.sets;
  if (!sets || typeof sets !== 'object' || !Object.keys(sets).length) throw bad('needs "sets" with at least one frame set');
  for (const [name, s] of Object.entries(sets as Record<string, unknown>)) {
    const f = (s ?? {}) as Record<string, unknown>;
    if (!positive(f.width) || !positive(f.height)) throw bad(`set "${name}" needs "width" and "height" above 0`);
    if (typeof f.pattern !== 'string' || !f.pattern.includes('{i}')) throw bad(`set "${name}" needs "pattern" with {i} in it`);
    if (!Number.isInteger(f.pad) || (f.pad as number) < 1) throw bad(`set "${name}" needs "pad", a whole number above 0`);
  }
  return m as Manifest;
}

// Upright screens get the tallest shape, wide screens the widest. Orientation,
// not width: an upright phone shows a tall slice, which a wide frame can only
// fill by upscaling a third of its pixels. Among sets of that shape (aspect
// within 5%), the smallest that fills the screen without enlarging, else the
// largest: a manifest can carry a lighter set for small screens.
// screen: the size to fill in device pixels; by default the window's, at
// most 2x (the player's own canvas cap). Given (a player in a box), the
// shape nearest its own (height over width) is taken, not the window's way
// up: a box a little taller than wide keeps the wide set, which shows more
// of the scene than a phone's slice of it.
export function pickSet(m: Manifest, screen?: { width: number; height: number }): { name: string; set: FrameSet } {
  const entries = Object.entries(m.sets);
  const shape = (s: FrameSet) => s.height / s.width;
  const shapes = entries.map(([, s]) => shape(s));
  const box = screen ? screen.height / screen.width : 0;
  const want = screen
    ? shapes.reduce((a, b) => (Math.abs(b - box) < Math.abs(a - box) ? b : a))
    : window.matchMedia('(orientation: portrait)').matches
      ? Math.max(...shapes)
      : Math.min(...shapes);
  const same = entries.filter(([, s]) => Math.abs(shape(s) / want - 1) <= 0.05).sort((a, b) => a[1].width - b[1].width);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width: sw, height: sh } = screen ?? { width: window.innerWidth * dpr, height: window.innerHeight * dpr };
  // Cover: the frame is scaled until it fills both ways.
  const fills = (s: FrameSet) => Math.max(sw / s.width, sh / s.height) <= 1.0001;
  const [name, set] = same.find(([, s]) => fills(s)) ?? same[same.length - 1];
  return { name, set };
}

// frame: counted from 1, as the files are named (frame 1 is 0001.webp).
export function frameUrl(base: string, set: FrameSet, frame: number): string {
  const n = String(frame).padStart(set.pad, '0');
  return base + set.pattern.replace('{i}', n);
}

// Directory of the manifest, with trailing slash.
export function manifestBase(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}
