// The engine of "flythrough/no-gsap": no GSAP. The scroll is read from the
// browser's own scroll events, measured against the track as it lies in the
// page at that moment (so content above the player may change height
// without a refresh). There is no glide here, on purpose: a glide is a loop
// that moves the page every frame, and the player never rolls its own. On
// this entry every glide goes through Lenis (player.useLenis), which the
// rest rule and the label taps already use when a host has it.
import type { Engine, Tracker, TrackOptions } from './engine.js';

class ScrollTracker implements Tracker {
  start = 0;
  end = 1;
  progress = 0;
  private o: TrackOptions;

  constructor(o: TrackOptions) {
    this.o = o;
    if (!trackers.size) {
      window.addEventListener('scroll', syncAll, { passive: true });
      window.addEventListener('resize', syncSoon);
    }
    trackers.add(this);
    this.sync();
  }

  sync = () => {
    this.start = this.o.start ? this.o.start() : this.o.trigger.getBoundingClientRect().top + window.scrollY;
    this.end = this.start + this.o.span();
    this.progress = Math.min(1, Math.max(0, (window.scrollY - this.start) / (this.end - this.start)));
    this.o.update(this.progress);
  };

  kill() {
    trackers.delete(this);
    if (!trackers.size) {
      window.removeEventListener('scroll', syncAll);
      window.removeEventListener('resize', syncSoon);
    }
  }
}

const trackers = new Set<ScrollTracker>();
const syncAll = () => trackers.forEach((t) => t.sync());
// A resized window is measured in the frame, not in the resize event: the
// player's own resize listener must first note the place it is at
// (flythrough.ts, onResize), whichever of the two was added first.
const syncSoon = () => requestAnimationFrame(syncAll);

export const nativeEngine: Engine = {
  glides: false,
  setup() {},
  track: (options) => new ScrollTracker(options),
  refresh: syncAll,
  glide: () => null,
};
