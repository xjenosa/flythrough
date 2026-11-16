# CLAUDE.md

Rules only, read on every session. What the project IS lives in README.md.
What is in flight is in QUEUE.md (gitignored): read it first. It has no DONE
section: an item is deleted in the turn it is finished, once anything worth
keeping is in the file that owns it, and the file is re-read at the end of
every batch of work.

The owner is non-technical: explain in plain language, plan first, build in
stages.

## Working

- Never commit or push unless asked. An ask covers the work done up to it,
  never what comes after.
- History follows the owner's public wishlist repo: a first commit
  `Initial commit` holding only LICENSE and a one-line README, as GitHub
  makes it, then one commit per version, `feat: flythrough <version>`, holding
  the whole tree. Subject only: no body, no co-author or AI attribution line.
- Until a version is on npm, its commit is not final. Each time the owner
  says commit and push, remake that version's commit on top of the one
  before it, check that its tree is exactly the working tree, and force-push
  main. The version number does not move until the owner publishes it.
- Once a version is published, its commit is fixed and never rewritten; tag
  it `v<version>`. The next version is a new commit on top, remade and
  force-pushed the same way until it is published.
- No em dash (U+2014) anywhere: code, comments, docs, commit messages, chat.
- Code comments are for an AI reader: keep only what bears load (constraints,
  invariants, cross-file links, a non-obvious reason).
- Test pages with Playwright's own browsers, never the owner's Chrome. One
  headless profile per session, deleted in the turn its run ends; never kill a
  browser by image name.
- Every script that opens a browser imports it from `tools/tidy-browser.cjs`,
  never straight from `playwright`: that file closes the run's browser and
  deletes its temp folder however the run ends (a throw, Ctrl+C, a kill).
- This repo never edits letramy.com. letramy keeps its own copy of the player
  until it switches to the package; that switch is done in the letramy repo.

## What must never be committed

- No secrets: no `.env`, no token. The repository is public.
- No generated output: `node_modules/` (also `examples/*/node_modules/`),
  `dist/`, `demo/dist/`, `examples/*/dist/`, `examples/next/.next/`,
  `examples/nuxt/.nuxt/` and `.output/`, the packed `*.tgz`, the demo's
  frames (`demo/public/tour/`, made by `npm run demo:frames`) and the
  examples' links to them (`examples/*/public/tour`), and the unpacked
  package the tests make (`examples/.packed/`).
- No private context: `QUEUE.md`, `CLAUDE.local.md` and
  `.claude/settings.local.json` stay local.

## Layout

- `src/` the player (the package's source); `bin/` the `flythrough` command;
  `demo/` the demo site and its footage; `examples/` one small project per
  framework (React, Vue, Svelte from this repo's source; Next and Nuxt with
  the packed package installed), never shipped; `test/` unit and browser
  tests; `tools/` scripts for working on the repo (build, screenshots,
  README snippets); `docs/` pictures the README shows.
- The code in README.md's Frameworks section is never written by hand: it is
  cut from `examples/` by `npm run snippets`, and `npm test` fails when the
  two differ. Change the example, run its test (`npm run test:examples`),
  then `npm run snippets`.
- `.github/workflows/checks.yml` runs the unit tests on Linux, Mac and
  Windows with ffmpeg (so the frame maker really runs on each), the type
  check and the build on every push. The browser tests need the demo frames
  and a screen-sized browser, so they run on the owner's computer
  (`npm run test:browsers`).
- `.github/workflows/pages.yml` publishes the demo to GitHub Pages
  (https://xjenosa.github.io/flythrough/) on every push to main, making the
  frames there from demo/footage. That is the demo's only public home: no
  other host, no preview site. Before a push, the demo is seen locally:
  `npm run demo` (this computer), `npm run demo:phone` (also a phone on the
  same Wi-Fi, at the network address it prints).

## Names (final)

- Package `flythrough`; element `<fly-through>`; classes `ft__*`; custom
  properties `--ft-*`; events `flythrough-ready`, `flythrough-progress`,
  `flythrough-stop` (a hyphen, never a colon: frameworks bind them in
  markup). After the first real release, renaming any of these, an
  attribute or a default is a breaking change.

## Spec

- README.md and the code are the spec for every setting and behaviour. A
  change to behaviour updates README.md and CHANGELOG.md with it.
- Behaviour that must not change:
  - Coming to rest: 0.5 s after scrolling stops, a 1.1 s glide to the stop
    whose card is showing. Only inside the player's track, never on host
    content above or below. The same with or without Lenis. Pushing against
    the top or bottom of the page (a touchpad's momentum, a phone's bounce)
    is not scrolling; only without Lenis, where the browser will not let the
    page cancel wheel momentum, the glide waits for it to stop pushing.
  - `return-to-first` (on by default with `intro`): anywhere in the track
    above the first stop glides back to it. `snap="off"` turns off only the
    pull to a showing card.
  - `autoscroll` (`auto`|`off`): `auto` moves the page on load (intro
    glide or jump to the first stop) only when the player is at the top of the
    screen.
  - When the page opens with the player at the top of the screen, it is
    held still while the loading screen is up (15 s at most), so the intro
    always plays. A player further down the page never holds a visitor who
    scrolls into it while it loads. The picture behind the screen stays on
    the opening frame until it lifts.
  - At rest the picture is one whole frame: the blend of two frames is only
    for a page that moves, and runs out a quarter of a second after it
    stops. A stop sits on a whole frame.
  - The loading screen never stays for good: 20 s with nothing arriving
    lifts it on what is in, or collapses the player when nothing came.
- Every glide goes through Lenis or GSAP's ScrollToPlugin, never a hand-rolled
  scroll loop. On `flythrough/no-gsap` that leaves Lenis: with it every
  behaviour above holds there too (the suite runs on both entries); without
  it nothing glides (a stop is jumped to, the page does not come to rest,
  `intro` opens on the first stop).
- The full-screen player on the default entry must behave and perform as it
  did before the box and the second entry existed: both add to its code
  paths only what is 0 or absent there.
- A setting ships only if a fair share of developers would use it; a
  behaviour one site wants is built on the player's events and methods, not
  added as an attribute.

## Package

- `gsap` is a peer dependency, required by the default entry
  (`flythrough`) and listed as required so that entry installs as before;
  `flythrough/no-gsap` never imports it. `lenis` is an optional peer.
  `react` and `vue` are optional peers, each imported only by its own entry
  (`flythrough/react`, `flythrough/vue`). No other runtime dependencies.
- The player's class (`src/flythrough.ts`) imports no library. How far the
  page has scrolled through the track, and the glide without Lenis, come
  from the engine its entry hands it (`src/engine.ts`): `src/gsap-engine.ts`
  for `flythrough`, `src/native-engine.ts` (no glide of its own) for
  `flythrough/no-gsap`. `sharp` and `ffmpeg-static` (optional peers) are for
  the frame maker only and never required by the player. `ffmpeg-static` is
  not a devDependency here (it downloads a large program on install): its
  path is tested with stand-ins.
- Run without `--frames`, `--from`, `--to` or `--format`, the frame maker
  must write the same files, byte for byte, as before: letramy's frames were
  made with it.
- Importing any entry must not touch `window` or `document` (server
  rendering): browser work starts in `connectedCallback`.
- The manifest helpers entry never imports gsap: hosts use it to preload
  frames on pages that do not load the player.
- A player in a box (`--ft-stage-height`) is styled only under the `boxed`
  attribute the player sets; the full-screen stage rules are not touched.
- No field, getter or method of the element is named after one of its
  attributes: frameworks set a prop as a property when the element has one
  of that name, and the player reads attributes.
- `flythrough/debug` (the layout overlay) is never imported by the player or
  the main entry, and its styles are inline, not in the stylesheet.
- The build (`tools/build.mjs`) gives every `private` class member a short
  name in `dist/` (the type checker says which uses are private; public
  names, attributes, events and other objects' properties are never
  touched). So a member a site may use is never marked `private`, and no
  file reads another class's private members except through an interface
  listed in the build's `MIRRORS` (the debug overlay's `Inner`). The
  browser tests run on `src/`; the built files are proven by
  `test/package.test.mjs` (it packs the package) and
  `node test/examples-test.mjs --packed`. The examples test uses only what
  a site may use (the page, attributes, events, documented methods).
- `flythrough/react` and `flythrough/vue` are thin components around the
  element (props written as attributes, events bound with addEventListener
  after mount, the player loaded in the browser with a dynamic import, the
  page taken to a new tour's top when the visitor was inside the one it
  replaces); the React entry also holds the JSX types. Neither is imported by the player
  or the main entry, and neither imports the stylesheet. Svelte has no
  component: it needs none. `svelte` and the build plugins are
  devDependencies for `examples/`, never peers.
- `examples/next` and `examples/nuxt` are real projects with their own
  `package.json`: the examples test installs their dependencies and the
  packed package into them, builds and runs them (Chromium, on the owner's
  computer). Their `node_modules`, build output and lockfiles are never
  committed.
- Demo footage is our own, so it can sit in the public repo; it never ships in
  the npm package. It is the grey blockout flight. The re-textured flight
  letramy uses is the owner's own and never goes in this repo or the demo.
