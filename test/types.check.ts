// Compile-only check (npm run typecheck): the public types fit real use.
import Lenis from 'lenis';
import { Flythrough, type LenisLike, type Stop, type ProgressDetail, type StopDetail } from '../src/index.js';
import { loadManifest, checkManifest, pickSet, frameUrl, manifestBase, MANIFEST_VERSION } from '../src/manifest.js';
import { debug } from '../src/debug.js';

const lenis: LenisLike = new Lenis();
const el = document.querySelector('fly-through');
el?.useLenis(lenis);
el?.goToStop(1);
el?.goToStop('lobby');
const p: number | null | undefined = el?.position;
if (el) el.position = 0.5;
el?.holdLoading(1200);
el?.holdLoading(document.fonts.ready);
const stop: Stop = { id: 'a', at: 0.5, from: 0.4, label: 'A', focus: [0.5, 0.5] };
const byFrame: Stop = { id: 'b', frame: 121, from: 88 };
const byTime: Stop = { id: 'c', time: 5 };
const undebug: () => void = debug(el);
debug()();
const ok: boolean = el instanceof Flythrough;
void loadManifest('/m.json').then((m) => frameUrl(manifestBase('/m.json'), pickSet(m, { width: 800, height: 600 }).set, 1));
const v: number = checkManifest({}).version ?? MANIFEST_VERSION;
// The events are typed on the element and, as they bubble, on the document
// and the window: no cast.
el?.addEventListener('flythrough-progress', (e) => {
  const d: ProgressDetail = e.detail;
  const n: number = d.progress + d.position + d.frame;
  void n;
});
document.addEventListener('flythrough-stop', (e) => {
  const d: StopDetail = e.detail;
  const id: string = d.id;
  const on: boolean = d.active;
  void [id, on];
});
window.addEventListener('flythrough-ready', (e) => {
  const none: null = e.detail;
  void none;
});
// @ts-expect-error not a field of the progress event
el?.addEventListener('flythrough-progress', (e) => void e.detail.id);
void [p, stop, byFrame, byTime, undebug, ok, v];
