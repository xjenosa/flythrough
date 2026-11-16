# Changelog

## 1.0.0

First release. The player was first built inside letramy.com; this is that
player as a package, with these changes:

### Package

- ESM with TypeScript types. Entries: `flythrough` (defines `<fly-through>`),
  `flythrough/style.css`, `flythrough/astro` (Astro component),
  `flythrough/manifest` (`loadManifest`, `checkManifest`, `pickSet`,
  `frameUrl`, `manifestBase`, `MANIFEST_VERSION`, without GSAP),
  `flythrough/react` and `flythrough/vue` (the `<Flythrough>` component for
  each; the React entry also types the element and its attributes for JSX),
  `flythrough/debug` (the layout overlay) and `flythrough/no-gsap` (the
  element without GSAP).
- The README says how to serve the frames from a CDN or another domain:
  where the frame addresses come from, cache headers, CORS (without it the
  frames load as plain images, the slower way) and what to switch off.
- Ready-made components for React (`flythrough/react`) and Vue
  (`flythrough/vue`), both named `Flythrough`: the settings as props
  (`stops` and `legs` as arrays, `intro` a boolean), the cards as children,
  the three events as `onReady`, `onProgress`, `onStop` (React) or `@ready`,
  `@progress`, `@stop` (Vue), and a ref to the element. Props stay live
  where the setting can change while the player runs; another `src`, `mode`
  or set of direct children (a card, a moment or the poster that comes,
  goes or changes place) builds a new player, and a visitor who was inside
  the old tour is taken to the top of the new one. They render the cards on a server and
  load the player in the browser; `gsap="off"` loads it without GSAP. `react`
  and `vue` are optional peer dependencies, each for its own entry only.
- Guides for React and Next, Vue and Nuxt, Svelte and SvelteKit in the
  README, with the component first and the element itself below it (Svelte
  uses the element: it needs no component). Their code is cut from the
  projects in `examples/`, which the test suite builds for production and
  runs in Chromium, Firefox and WebKit, as server-rendered pages taken over
  in the browser and as pages the browser fills. The suite also installs the
  package into a real Next (App Router) project and a real Nuxt project,
  builds them and runs them.
- The events are typed: `flythrough-ready`, `flythrough-progress` and
  `flythrough-stop` are in TypeScript's event maps for elements, `document`
  and `window`, so a listener knows `e.detail` without a cast. The detail
  types are exported as `ProgressDetail` and `StopDetail`.
- No attribute of the element is also one of its properties, so React, Vue
  and Svelte always set the settings as attributes (they set a property
  instead when the element has one of that name; `stops`, `mode`, `fit`,
  `snap`, `reach` and `glide` would have been lost that way).
- The built files give the player's private members short names, so a
  page carries less: the player is about 14.8 kB minified and gzipped
  (GSAP and Lenis apart). No public name changes: attributes, properties,
  methods, events, classes and custom properties are as the README has
  them. The test suite runs the example projects against the packed
  package as well as against the source.
- MIT licensed.
- `gsap` is a peer dependency (the default entry's); `lenis`, `react` and
  `vue` are optional ones.
- Safe to import on a server. Node 20.19 or later (22.12 on Node 22): from
  there Node can import GSAP's files, which the default entry loads.
- The types of every entry are also found under TypeScript's older
  `moduleResolution: "node"`.
- The Astro component passes `class`, `id`, `style` and `data-*` on to the
  element, so a class from the page's own `<style>` applies to the player.
- The README shows a page with no build step (the built files from a CDN,
  GSAP through an import map), how to place the cards for motion and for
  stills, and how to keep a visitor's place on a reload.
- The frame maker is a command: `npx flythrough frames <video> --out <folder>`.
  It says how to install ffmpeg or sharp when either is missing, needs
  `--out`, and never clears a folder it did not make. It works with ffmpeg
  before 5.1 too, keeps frames in order past 9999 (longer names, the
  manifest's `pad` says how long), and writes `"version": 1` into the
  manifest. Tested on Linux, Mac and Windows.
- The frame maker no longer needs ffmpeg installed on the computer: with the
  `ffmpeg-static` package in the project (an optional peer dependency) it
  uses the ffmpeg that package brings. `FFMPEG_PATH` names one explicitly.
  ffprobe is not needed any more.
- New frame maker options: `--frames <n>` (keep n frames, evenly spread,
  first and last included), `--from` and `--to` (use only part of the
  video), `--format avif` (smaller files than WebP, slower to make and to
  decode, Safari from 16.4).
- The frame maker ends with a report: each set's size in all and per frame,
  how much the loading screen waits for, which file to use as the poster,
  and a note when a set is heavy for a phone. Long sets show their progress.
- The frame maker's `--stops` file can be the list the player takes
  (`[{ "frame": 49, "focus": [x, y] }, ...]`), with each stop placed by
  frame, by seconds or by `at`; the older `{ "frames": N, "stops": [...] }`
  still works and crops as before. A file that is not JSON, holds no stops
  or has a stop without a place is refused before any work, saying which.

### New

- Lazy start: a player more than two screen heights below the screen
  downloads nothing (no manifest, no frames) until the visitor is within two
  screen heights of it. A player at or near the top of the page starts at
  once, as do all players on a reload or a back or forward navigation, and
  one whose `position` is set before it loads. A visitor below a waiting
  player keeps their place in the page when it gets its height.
- A visitor with a data saver on or on a 2G connection gets the stills
  instead of the flight (where the browser reports it: Chrome, Edge and
  other Chromium browsers). `mode="scrub"` still forces the flight.
- A poster: a child `<img data-poster>` (or `<picture data-poster>`, to
  give upright phones their own frame) fills the player's first screen from
  the first paint until the first frame is drawn, and stays as the picture
  when scripting is off.
- Stops can be placed by frame number (`"frame": 121`, counted from 1 as the
  frame files are) or by seconds (`"time": 5`) as well as by `at` (0 to 1);
  a stop's `from` is in the same unit. Moments take `data-from-frame` and
  `data-to-frame`, or `data-from-time` and `data-to-time`. A stop with no
  place is left out with a console warning. A stop is put on the nearest
  whole frame, so the picture at a stop is one sharp frame.
- The console says more of what is wrong on a page: a stop written past the
  end of the footage, a card that matches no stop, a moment whose ends are
  not in the footage (frame numbers in `data-from`), a missing stylesheet,
  a page margin that keeps the tour from opening, and an `intro` on
  `flythrough/no-gsap` that found no Lenis. A manifest that cannot be
  fetched or is a page instead of JSON says what to look at.
- Where `off` turns a setting off (`snap`, `bar`, `return-to-first`,
  `autoscroll`), `false` does too, as for `intro`.
- A player that has no `src` when it joins the page starts when it gets
  one.
- `flythrough/debug`: an overlay for laying out a tour, as its own import
  (`debug()`), never part of the player. It shows the frame on screen, the
  place in the footage and in the track, and on a strip of the whole track
  each stop's reach and each moment's stretch.
- `--ft-progress`: an element inside the player marked `data-progress` gets
  this custom property, how far the flight is from 0 to 1, kept up to date
  as the page scrolls, so a site's own CSS can move or fade things with the
  flight (as `--ft-moment` does inside a moment). Only marked elements get
  it: set on the whole player it cost a slow phone its smooth scroll.
- A README recipe for analytics: which stops visitors reach, from the
  `flythrough-stop` event; cut from an example the test suite runs.
- A stop can be written on its card instead of in the `stops` JSON:
  `<div data-stop="lobby" data-frame="121" data-label="Lobby">`, with
  `data-at` or `data-time` for the place and `data-from`, `data-focus` as
  in the JSON. The `stops` attribute stays for frameworks and counts when
  it is there. `legs` also takes a plain list (`legs="0.45 1.3 1.7"`).
  Stops that are not valid JSON are said in the console.
- Settings are live: an attribute changed while the player runs takes
  effect (the pacing keeps the visitor's place in the flight; stops, labels
  and cards move; `reach`, `snap`, `glide`, `return-to-first`, `fit`,
  `bar`, `bar-label` and `loading-text` at once). `src` and `mode` are
  read at the start only, and say so in the console when changed later.
- `goToStop` takes a stop's id as well as its number.
- A player in a section: with `--ft-stage-height` set on the element (in
  `vh` or `px`) the picture is a box of that height in the page, as wide as
  the element, pinned in the middle of the screen while its flight scrolls
  by, instead of filling the screen. The frame set follows the box's shape
  and size; the element carries `boxed`. Without the property the
  full-screen player is unchanged.
- `flythrough/no-gsap`: the same element without GSAP. A plain scrub needs
  nothing else; with stops the glides are Lenis's (`useLenis`), and with
  Lenis it behaves as the default entry does. Without Lenis there stops are
  jumped to and the page does not come to rest.
- `glide="scaled"` (off by default): the glide to rest takes 0.6 s plus 0.8 s
  per screen height travelled, 1.4 s at most, instead of a fixed 1.1 s. The
  intro, label taps and the return to the first stop keep their own timing.
- The return to the first stop (`return-to-first`) is the opening played
  again: it flies at the intro's pace for the frames it crosses and eases
  out onto the stop like the intro, instead of the 1.1 s glide to rest.
- Loading screen hooks: the "%" is its own element (`.ft__loading-sign`, next
  to the number in `.ft__loading-num`, both inside `.ft__loading-pct`); the
  number counts up evenly behind real progress, never ahead of it; and
  `--ft-loading-fade` (450 ms by default) sets how long the screen fades,
  which the player follows for removing it and starting the intro.
- `player.holdLoading(msOrPromise)` keeps the loading screen up longer, so
  what a site shows on it is not cut off on a fast load: a number of
  milliseconds from when it appeared (the number on it then counts evenly to
  100 over that time, never ahead of what has loaded), or a promise, until
  it settles. `flythrough-ready` and the `ready` attribute come with the
  lift.
- `position` can be set: before the player loads it is where the player
  opens (to restore a visitor's place), after it the page jumps there.
- The page is held still under the loading screen only when it opens with
  the player at the top of the screen. A player further down the page no
  longer stops a visitor who scrolls into it while it loads.
- A page that is somewhere else as the player loads (content above it, a
  scroll the browser put back) opens on the place it is at: those frames
  load first and are the picture behind the loading screen, which no longer
  waits an extra second there.
- At rest the picture is always one frame: a scroll left between two frames
  showed the mix of both, which read as a doubled picture on fast footage.
  A quarter of a second after the flight stops, the mix runs out to the
  nearer frame. While the page moves, frames are blended as before.
- If nothing arrives for 20 seconds while the loading screen is up, it
  lifts on the frames that are in; with none in, or a manifest that has not
  answered, the player steps aside (`error`). A frame that fails while the
  device is offline waits for the connection instead of using up its tries.
- `flythrough-progress` also carries `position`, the position in the track
  (0 to 1, the `position` property). Its `frame` counts from 1, as the
  frame files and a stop's `frame` do; so does the `frameUrl` helper.
- A manifest can hold sets of the same shape in several sizes; each screen
  gets the smallest that fills it (`pickSet`).
- Keyboard: the stop labels are one stop in the Tab order, with the arrow
  keys (and Home and End) between them; the next Tab is the showing card.
- Stills: each moment is a full screen over the frame from the middle of its
  stretch, as each stop is over its own (moments had no picture and only
  their own height). The section carries `.ft__still--moment`. Only the
  first still loads at once; the rest load as the visitor nears them.

### Renamed (letramy's copy used the old names)

- The events are `flythrough-ready`, `flythrough-progress` and
  `flythrough-stop`, with a hyphen instead of a colon, so frameworks can
  bind them in markup (a colon cannot be written as a JSX prop).
- The `window` attribute is now `reach` (Astro prop `reach`), and it is
  written in screen heights of scroll, as `legs` and `hold` are
  (`reach="0.38"`), not as a share of the track.
- `no-bar` is now `bar="off"` (Astro prop `bar`). `intro="false"` or
  `intro="off"` is off.
- `mode` is no longer rewritten to the mode in use; the element sets the
  `stills` attribute when it shows stills (style `fly-through[stills]`, not
  `fly-through[mode='stills']`).
- `.is-past` on a label is now `.ft__label--past`; `.is-done` on the loading
  screen is now `.ft__loading--done`.
- The element no longer shows a `data-booted` attribute.

### Removed

- `hint`: put the text in the first stop's card.
- `start`: set `position` before the player loads instead.
- `autoscroll="on"`: `auto` and `off` remain.

### Faster and lighter

- Frames are fetched as files and decoded off the page's main thread, about
  thirty at a time around the visitor, instead of decoded by the browser
  while drawing. On a slow phone (simulated, letramy's tour): a steady
  scroll went from 23 pictures a second with 19 long pauses to a full frame
  rate with none; a label tap from first stop to last from 10 long pauses
  to none; the opening glide from 12 slow frames to 1. Neighbouring frames
  are blended only while the flight moves less than a frame per screen
  refresh. The page holds at most about thirty decoded frames however long
  the flight. Safari and every iPhone browser (Safari's engine decodes in
  the background slowly, one frame at a time), frames from another domain
  without CORS, and browsers without `createImageBitmap` draw the old way,
  with the blending rule above.
- Twelve frames load at once instead of six: on a phone on 4G the tour was
  usable after 3.2 s instead of 3.9 s, and every frame was in after 11.6 s
  instead of 17 s.
- Frames still loading no longer hold back the page's `load` event (the
  tab's loading spinner ran until every frame was in). Not in Safari, which
  still loads frames as images.

### Fixes

- The phone address bar: the track is measured against the screen's height
  with the bar hidden (`100lvh`, letramy's own fix), so the bar showing or
  hiding never moves the picture or the stops, and the last stop is always
  reachable. Rotating, or resizing a window, keeps the visitor at the same
  place in the flight. The canvas redraws at once on a resize, with no black
  frame in between.
- The loading screen's blur shows in Chrome, Edge and Firefox on sites built
  with Vite: the stylesheet now puts `-webkit-backdrop-filter` before
  `backdrop-filter` (Vite's CSS minifier keeps only the last of the two).
- After a flick to the top on a touchpad or phone, the glide back to the
  first stop starts half a second after the page stops, instead of half a
  second after the touchpad's momentum or the phone's bounce has died out
  (in a test with 1.2 s of momentum: 1.8 s after the finger lifted, now
  0.5 s). Pushing against the top or bottom of the page no longer counts as
  scrolling. With Lenis, the player sets its `virtualScroll` option for this
  (a host's own still runs first).
- Glides no longer stop part way on iPhones. A label tap, `goToStop()` or
  the glide to rest could stop after a short distance and stay there, or
  stop and start again: GSAP's `autoKill` took Safari's scroll position,
  read a frame late (WebKit bug 236312), for the visitor scrolling. Without
  Lenis the player now watches its glide itself and ignores the positions it
  set in the last few frames.
- A stray wheel event of a pixel or two during a glide (a touchpad's
  fingers resting or lifting, the end of its momentum) no longer stops it
  short for a second glide to finish the trip half a second later, with or
  without Lenis. A real scroll still takes over at once.
- Touchpad momentum against the top is judged by its speed, so two events a
  browser merges into one no longer read as a new flick that cuts the glide
  back to the first stop short.
- `hold` works without `legs` too (it was silently ignored).
- When stills cannot load their manifest, the player really takes no room:
  the hidden cards no longer leave a blank gap.
- Stops and moments no longer flash as plain text before the script runs:
  they stay hidden until the player moves them into place (shown as page
  content when scripting is off).
- In stills, a phone no longer zooms the page out when a line of text would
  have been wider than the screen unwrapped: each still is clipped at the
  sides.
- Stop labels and the loading text are inserted as plain text, never as HTML.
- A frame that fails to load is retried twice (not when the server says it
  is not there); if it still fails, it counts as done, so the loading screen
  always lifts.
- When no frame loads at all, or the manifest is missing, not JSON, not a
  manifest or of a newer version, the player collapses (`error` attribute)
  within seconds and says why in the console, instead of leaving a loading
  screen up (58 s when every frame failed, forever for a broken manifest).
- A label tap or `goToStop()` while the loading screen is up is ignored,
  instead of scrolling the page under it. `goToStop()` works in stills mode
  (it jumped nowhere and threw).
- Removing the player removes its listeners, its ScrollTrigger and its
  pending glides, and stops loading frames. Putting it back starts it again.
- Colours follow `--ft-fg` and `--ft-bg` throughout (labels, the bar's line,
  the loading screen); `--ft-accent` defaults to `--ft-fg`. The default look
  is unchanged.
- On narrow screens, stop buttons keep their names for screen readers (the
  labels are hidden visually only). The loading percentage is no longer read
  out at every step. The stop bar comes before the cards for the keyboard.
- Console warnings for host layouts that break the player: a page that
  scrolls inside a box instead of the window, and an element around the
  player with `overflow` hidden, auto or scroll (use `overflow: clip`).
- Safari's engine: a `<fly-through>` that a framework had copied out of a
  template before the player's script loaded (Svelte building the page in
  the browser, Lit) never started, because WebKit leaves such an element
  out when the player registers itself (WebKit bug 307920). The player now
  takes those elements over itself.
- A script that runs before the page has been read to the end (`async`, or
  in the `<head>` without `defer`) met the element before its children:
  stills were built without their cards and the cards stayed hidden; in
  motion the poster stayed as an extra screen. The player now waits for its
  children.
- Content above the player that changes height after the page has loaded (a
  picture arriving late, an accordion) left the player off by that much
  until the window was resized: the wrong frame for the place, label
  flights landing short. The player now notices and measures again.
- Before the player's script arrives, the element keeps one screen (or its
  box) instead of the height of its hidden cards, so what is below it no
  longer shows at the top of the screen and then jumps down.
- A nearly square box in the page took the upright (phone) frame set; a box
  now takes the set whose shape is nearest its own.
- The Astro component's file is no longer named like the stylesheet: a site
  that used the component and also imported `flythrough/style.css` built
  two CSS files whose names differed only in case, one of which a server
  that tells cases apart did not have.
- A page's own `history.scrollRestoration`, set after the player started,
  was put back at the next window resize: GSAP's ScrollTrigger writes back
  the value it found when it started. With the recipe for keeping the
  place on a reload, a visitor who had resized the window or turned a
  phone inside the tour was left at the end of the tour by a reload. The
  default entry now tells ScrollTrigger the page's value as each of its
  refreshes begins. (`flythrough/no-gsap` never touched it.)
- `holdLoading(ms)`: the number on the loading screen takes its time from
  the clock, as the lift does, not from the animation frame's own
  timestamp. In a busy frame it stood up to 3 behind the time it was
  written at.

### Unchanged

How it feels: coming to rest (0.5 s, then a 1.1 s glide to the stop whose
card is showing, only inside the track), when `return-to-first` applies, `snap`,
`autoscroll="auto"` and `"off"`, the intro, the page held still while the
loading screen is up on a page that opens on the player (15 s at most),
pacing with `legs` and `hold`, and the names `<fly-through>`, `ft__*` and
`--ft-*`.
