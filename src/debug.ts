// Package entry "flythrough/debug": an overlay for laying out a tour. It
// shows the frame on screen (numbered from 1, as the frame files and a
// stop's `frame` are), the place in the footage and in the track, and, on a
// strip of the whole track, how far each stop's card reaches and where each
// moment runs.
//
// Never imported by the player (src/index.ts, src/flythrough.ts): a page
// that wants it imports it, so it adds nothing to a site that does not.
// Importing it touches no window or document; debug() does. It reads the
// player's own fields (Inner below), so it belongs to the player it ships
// with. Its styles are inline: the package stylesheet carries none of it.
import { clamp01, flightAt, scrollAt, stopLow, type Layout, type Reach, type StopPoint } from './math.js';
import type { Flythrough } from './flythrough.js';

// What it reads from the player (private there).
interface Inner {
  booted: boolean;
  layout: Layout;
  stopList: (StopPoint & { id: string })[];
  moments: { from: number; to: number; el: HTMLElement }[];
  manifest?: { frames: number; fps: number };
  reachOf: Reach;
  scrollPos: number;
  progress: number;
  frame: number;
  activeStop: string | null;
  stage?: HTMLElement;
}

const el = (style: string, text = ''): HTMLElement => {
  const e = document.createElement('div');
  e.style.cssText = style;
  e.textContent = text;
  return e;
};

// Shows the overlay on one player, or with no argument on every
// <fly-through> on the page. Returns a function that removes it. In stills
// there is no track to show, so it does nothing.
export function debug(player?: Flythrough | null): () => void {
  if (!player) {
    const all = Array.from(document.querySelectorAll('fly-through')).map((p) => debug(p));
    return () => all.forEach((off) => off());
  }
  const p = player as unknown as Inner;
  const off = new AbortController();
  let box: HTMLElement | undefined;
  let read: HTMLElement;
  let mark: HTMLElement;
  let strip: HTMLElement;
  let drawnFor: Layout | undefined;

  // The whole track from top (0) to bottom (1): a band for each stop's
  // reach with a line at the stop, a narrow band for each moment.
  const bands = () => {
    drawnFor = p.layout;
    const n = p.manifest?.frames ?? 1;
    const frameAt = (sp: number) => Math.round(flightAt(p.layout, clamp01(sp)) * (n - 1)) + 1;
    strip.replaceChildren(mark);
    p.stopList.forEach((s, k) => {
      const at = p.layout.stopScroll[k];
      const lo = clamp01(stopLow(p.layout, p.stopList, k, p.reachOf));
      const hi = clamp01(at + p.reachOf.reach);
      const band = el(
        `position:absolute;left:14px;right:0;top:${lo * 100}%;height:${(hi - lo) * 100}%;min-height:1px;background:rgba(90,200,255,.3);outline:1px solid rgba(90,200,255,.8)`,
      );
      band.dataset.debugStop = s.id;
      const line = el(`position:absolute;left:14px;right:0;top:${at * 100}%;height:1px;background:#fff`);
      const name = el(
        `position:absolute;right:calc(100% + 6px);top:${at * 100}%;transform:translateY(-50%);white-space:nowrap;padding:1px 5px;background:rgba(0,0,0,.72);border-radius:3px`,
        `${s.id}  frame ${frameAt(at)}  reach ${frameAt(lo)} to ${frameAt(hi)}`,
      );
      strip.append(band, line, name);
    });
    for (const m of p.moments) {
      const from = scrollAt(p.layout, m.from);
      const to = scrollAt(p.layout, m.to);
      const band = el(`position:absolute;left:0;width:8px;top:${from * 100}%;height:${(to - from) * 100}%;min-height:1px;background:rgba(255,190,70,.75)`);
      band.dataset.debugMoment = '';
      strip.append(band);
    }
  };

  const update = () => {
    if (!box) return;
    if (drawnFor !== p.layout) bands();
    const n = p.manifest?.frames ?? 1;
    const fps = p.manifest?.fps || 24;
    read.textContent = [
      `frame ${p.frame + 1} of ${n}`,
      `at ${p.progress.toFixed(4)}   time ${(p.frame / fps).toFixed(2)} s`,
      `track ${p.scrollPos.toFixed(4)}`,
      `stop ${p.activeStop ?? 'none'}`,
    ].join('\n');
    mark.style.top = `${p.scrollPos * 100}%`;
  };

  const build = () => {
    if (box || !p.booted || !p.stage) return;
    box = el('position:absolute;inset:0;z-index:3;pointer-events:none;color:#fff;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace');
    box.className = 'ft__debug';
    box.setAttribute('aria-hidden', 'true');
    read = el('position:absolute;left:12px;top:12px;padding:8px 10px;white-space:pre;background:rgba(0,0,0,.72);border-radius:4px');
    read.className = 'ft__debug-read';
    strip = el('position:absolute;right:12px;top:12px;bottom:12px;width:44px;background:rgba(0,0,0,.45)');
    strip.className = 'ft__debug-track';
    mark = el('position:absolute;left:-4px;right:-4px;height:2px;margin-top:-1px;background:#ff5a5a');
    mark.className = 'ft__debug-mark';
    box.append(read, strip);
    p.stage.append(box);
    update();
  };

  if (player.hasAttribute('stills')) {
    console.info('flythrough/debug: the player is showing stills; there is no track to show');
    return () => {};
  }
  // Before the manifest is in there is no track yet: the first picture
  // drawn, or the loading screen lifting, comes after it.
  const opts = { signal: off.signal };
  player.addEventListener('flythrough-progress', () => (box ? update() : build()), opts);
  player.addEventListener('flythrough-stop', update, opts);
  player.addEventListener('flythrough-ready', build, opts);
  build();
  return () => {
    off.abort();
    box?.remove();
    box = undefined;
  };
}
