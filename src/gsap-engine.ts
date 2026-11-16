// The default engine: GSAP. ScrollTrigger maps the scroll to the player's
// progress, ScrollToPlugin glides the page when the host has no Lenis. The
// calls are the ones the player made itself before the engines were split
// out: same options, same order (engine.ts says what an engine is).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import type { Engine } from './engine.js';

// ScrollTrigger measures where a track is when it is made, when the window
// is resized and when the player asks (refresh). Content above a player
// that changes height later (a picture arriving, an accordion) moves the
// track without any of those: the player then showed the wrong frame for
// the place and flew a label short by that much. The page changing height
// is the sign: a track that is no longer where its trigger has it is
// measured again, by itself, at once. top: where the track starts now.
const tracks = new Set<{ st: ScrollTrigger; top: () => number }>();
let watch: ResizeObserver | undefined;
const measure = () => {
  for (const t of tracks) {
    if (Math.abs(t.top() - t.st.start) <= 1) continue;
    t.st.refresh();
    // refresh() keeps the progress it had: read the scroll again.
    t.st.update();
  }
};

// ScrollTrigger notes history.scrollRestoration when it starts and writes
// that value back at the end of every refresh of all its triggers (a window
// resize, refresh below), undoing a page that has set it since: README's
// reload recipe sets "manual" while the visitor is inside the tour, and
// after a resize a reload left them at the end of it. Told the page's value
// as each refresh begins, it writes back what was there. (During a refresh
// this call leaves the scroll positions just recorded alone.)
const keepRestoring = () => ScrollTrigger.clearScrollMemory(history.scrollRestoration);

export const gsapEngine: Engine = {
  glides: true,
  setup() {
    gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
    // Once: ScrollTrigger keeps one of each function.
    ScrollTrigger.addEventListener('refreshInit', keepRestoring);
  },
  track({ trigger, start, span, update }) {
    const st = ScrollTrigger.create({
      trigger,
      start: start ?? 'top top',
      end: () => '+=' + span(),
      onUpdate: (self) => update(self.progress),
      onRefresh: (self) => update(self.progress),
    });
    const entry = { st, top: start ?? (() => trigger.getBoundingClientRect().top + window.scrollY) };
    tracks.add(entry);
    watch ??= new ResizeObserver(measure);
    watch.observe(document.body);
    return {
      get start() {
        return st.start;
      },
      get end() {
        return st.end;
      },
      get progress() {
        return st.progress;
      },
      kill() {
        tracks.delete(entry);
        st.kill();
      },
    };
  },
  refresh() {
    ScrollTrigger.refresh();
  },
  glide(y, duration, ease, on) {
    const tween: gsap.core.Tween = gsap.to(window, {
      scrollTo: { y, autoKill: false },
      duration,
      ease,
      onStart: on.start,
      onUpdate: () => on.update(tween.progress()),
      onComplete: on.complete,
    });
    return tween;
  },
};
