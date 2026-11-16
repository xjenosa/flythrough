// The manifest helpers (src/manifest.ts): what counts as a manifest, and which
// frame set a screen gets. pickSet reads window.matchMedia and the window's
// size, stubbed here per case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest, loadManifest, pickSet, frameUrl, type Manifest } from '../src/manifest.ts';

const set = (width: number, height: number, name: string) => ({ width, height, pattern: `${name}/{i}.webp`, pad: 4 });
const good = { version: 1, fps: 24, duration: 2, frames: 48, sets: { landscape: set(1280, 720, 'landscape') } };

test('a manifest from the frame maker passes, with or without a version', () => {
  assert.equal(checkManifest(good), good);
  const { version, ...old } = good;
  void version;
  assert.equal(checkManifest(old), old);
});

test('anything else is refused, naming what is wrong', () => {
  assert.throws(() => checkManifest({}), /needs "frames"/);
  assert.throws(() => checkManifest(null), /not a manifest/);
  assert.throws(() => checkManifest([]), /not a manifest/);
  assert.throws(() => checkManifest({ ...good, version: 2 }), /version 2; this player reads version 1/);
  assert.throws(() => checkManifest({ ...good, frames: 0 }), /needs "frames"/);
  assert.throws(() => checkManifest({ ...good, frames: 2.5 }), /needs "frames"/);
  assert.throws(() => checkManifest({ ...good, fps: '24' }), /needs "fps"/);
  assert.throws(() => checkManifest({ ...good, sets: {} }), /needs "sets"/);
  assert.throws(() => checkManifest({ ...good, sets: { a: { ...set(0, 720, 'a') } } }), /set "a" needs "width"/);
  assert.throws(() => checkManifest({ ...good, sets: { a: { ...set(1280, 720, 'a'), pattern: 'a/x.webp' } } }), /needs "pattern"/);
  assert.throws(() => checkManifest({ ...good, sets: { a: { ...set(1280, 720, 'a'), pad: 0 } } }), /needs "pad"/);
});

function onScreen(portrait: boolean, width: number, height: number, dpr = 1) {
  (globalThis as any).window = {
    matchMedia: () => ({ matches: portrait }),
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
  };
}

const sets: Manifest = {
  ...good,
  sets: {
    small: set(960, 540, 'small'),
    large: set(1920, 1080, 'large'),
    portrait: set(406, 720, 'portrait'),
  },
};

test('pickSet: the shape follows the orientation', () => {
  onScreen(true, 390, 844, 3);
  assert.equal(pickSet(sets).name, 'portrait');
  onScreen(false, 1440, 900, 2);
  assert.equal(pickSet(sets).name, 'large');
});

test('pickSet: among one shape, the smallest that fills the screen, else the largest', () => {
  onScreen(false, 800, 450, 1);
  assert.equal(pickSet(sets).name, 'small');
  onScreen(false, 1280, 720, 1);
  assert.equal(pickSet(sets).name, 'large');
  onScreen(false, 2560, 1440, 2);
  assert.equal(pickSet(sets).name, 'large');
  assert.equal(pickSet(sets, { width: 900, height: 500 }).name, 'small');
});

test('pickSet: one set per shape picks as before', () => {
  const two: Manifest = { ...good, sets: { landscape: set(1280, 720, 'landscape'), portrait: set(406, 720, 'portrait') } };
  onScreen(false, 640, 360, 1);
  assert.equal(pickSet(two).name, 'landscape');
  onScreen(true, 360, 640, 1);
  assert.equal(pickSet(two).name, 'portrait');
});

test('pickSet: a box takes the shape nearest its own, not the way up of the window', () => {
  // A wide window; the box decides.
  onScreen(false, 1440, 900, 1);
  assert.equal(pickSet(sets, { width: 400, height: 700 }).name, 'portrait');
  assert.equal(pickSet(sets, { width: 900, height: 500 }).name, 'small');
  // A little taller than wide is still nearer the wide shape (0.56) than
  // the upright one (1.77): the wide set shows more of the scene.
  assert.equal(pickSet(sets, { width: 600, height: 620 }).name, 'large');
  assert.equal(pickSet(sets, { width: 600, height: 690 }).name, 'large');
  assert.equal(pickSet(sets, { width: 600, height: 720 }).name, 'portrait');
  // An upright window, a wide box in it.
  onScreen(true, 390, 844, 3);
  assert.equal(pickSet(sets, { width: 1170, height: 600 }).name, 'large');
});

test('loadManifest: a failed request and a page in place of the file say what to look at', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await assert.rejects(loadManifest('https://other.example/tour/manifest.json'), (err: Error) => err.message === 'flythrough: manifest https://other.example/tour/manifest.json could not be fetched (Failed to fetch): no connection, or another domain that sends no CORS header');
    globalThis.fetch = (() => Promise.resolve(new Response('<!doctype html><title>app</title>', { status: 200 }))) as typeof fetch;
    await assert.rejects(loadManifest('/tuor/manifest.json'), (err: Error) => err.message === 'flythrough: manifest /tuor/manifest.json is not JSON (is the path right?)');
    globalThis.fetch = (() => Promise.resolve(new Response('', { status: 404 }))) as typeof fetch;
    await assert.rejects(loadManifest('/tour/manifest.json'), (err: Error) => err.message === 'flythrough: manifest /tour/manifest.json 404');
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(good), { status: 200 }))) as typeof fetch;
    assert.deepEqual(await loadManifest('/tour/manifest.json'), good);
  } finally {
    globalThis.fetch = real;
  }
});

test('frameUrl counts frames from 1, as the files are named, and pads to the set', () => {
  assert.equal(frameUrl('/t/', set(1, 1, 'a'), 1), '/t/a/0001.webp');
  assert.equal(frameUrl('/t/', set(1, 1, 'a'), 49), '/t/a/0049.webp');
  assert.equal(frameUrl('/t/', { ...set(1, 1, 'a'), pad: 5 }, 12345), '/t/a/12345.webp');
});
