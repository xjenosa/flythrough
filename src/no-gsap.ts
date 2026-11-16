// Package entry "flythrough/no-gsap": the same <fly-through> without GSAP.
// The scroll is read from the browser's own events (native-engine.ts). It
// has no glide of its own: with Lenis handed to it (player.useLenis) every
// glide is Lenis's and the player behaves as on the default entry; without
// Lenis a plain scrub is complete, stops are jumped to and the page does
// not come to rest.
import { define } from './flythrough.js';
import { nativeEngine } from './native-engine.js';

define(nativeEngine);

export { Flythrough, type Stop, type LenisLike, type ProgressDetail, type StopDetail } from './flythrough.js';
export { loadManifest, checkManifest, pickSet, frameUrl, manifestBase, MANIFEST_VERSION, type Manifest, type FrameSet } from './manifest.js';
