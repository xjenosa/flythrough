// Package entry "flythrough": importing it defines <fly-through> (in a
// browser), on GSAP. The stylesheet is a separate entry,
// "flythrough/style.css"; the manifest helpers are also "flythrough/manifest",
// which never loads gsap; "flythrough/no-gsap" is this entry without GSAP.
import { define } from './flythrough.js';
import { gsapEngine } from './gsap-engine.js';

define(gsapEngine);

export { Flythrough, type Stop, type LenisLike, type ProgressDetail, type StopDetail } from './flythrough.js';
export { loadManifest, checkManifest, pickSet, frameUrl, manifestBase, MANIFEST_VERSION, type Manifest, type FrameSet } from './manifest.js';
