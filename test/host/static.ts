// Script of static.html (never shipped). Query: aboveh=<vh> (content above
// the player, that tall), src=<manifest url>, picture=1 (the poster as a
// <picture> with a portrait source), n=<0001..> (the frame the poster shows,
// default 0049, the first stop's), fit=contain, noposter=1, below=0 (no
// content below), stage=<vh> (a box: --ft-stage-height), nocss=1 (the
// stylesheet taken out), wait=1 (the player's script is never loaded: the
// page as it is before it arrives), keep=1 (README's recipe for keeping
// the place on a reload).
const q = new URLSearchParams(location.search);
const el = document.getElementById('player')!;
if (q.get('aboveh')) document.getElementById('above')!.style.height = `${q.get('aboveh')}vh`;
if (q.get('below') === '0') document.getElementById('below')!.remove();
if (q.get('src')) el.setAttribute('src', q.get('src')!);
if (q.get('fit')) el.setAttribute('fit', q.get('fit')!);
if (q.get('stage')) el.style.setProperty('--ft-stage-height', `${q.get('stage')}vh`);
if (q.get('nocss') === '1') document.querySelector('link[rel="stylesheet"]')!.remove();
if (q.get('noposter') === '1') el.querySelector('[data-poster]')!.remove();
const n = q.get('n');
if (n) el.querySelector<HTMLImageElement>('[data-poster]')?.setAttribute('src', `/tour/landscape/${n}.webp`);
if (q.get('picture') === '1') {
  const pic = document.createElement('picture');
  pic.setAttribute('data-poster', '');
  pic.innerHTML = `<source media="(orientation: portrait)" srcset="/tour/portrait/${n ?? '0049'}.webp" /><img src="/tour/landscape/${n ?? '0049'}.webp" alt="" />`;
  el.querySelector('[data-poster]')!.replaceWith(pic);
}
(window as any).__player = el;

// README.md, "Recipe: keeping the place on a reload", as it is written
// there (test/features-test.mjs reloads this page).
if (q.get('keep') === '1') {
  const player = document.querySelector('fly-through')!;
  const KEY = 'tour-place';
  const came = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  const saved = came === 'reload' || came === 'back_forward' ? sessionStorage.getItem(KEY) : null;
  if (saved !== null) player.position = Number(saved);
  // While the visitor is inside the tour the place is the player's to hand
  // back, so the browser must not put the scroll back as well: it would, before
  // any script of the reloaded page has run. Outside the tour it may.
  let inside = saved !== null;
  const restoring = () => (history.scrollRestoration = inside ? 'manual' : 'auto');
  restoring();
  player.addEventListener('flythrough-progress', (e) => {
    const now = e.detail.position > 0 && e.detail.position < 1;
    if (now !== inside) {
      inside = now;
      restoring();
    }
  });
  addEventListener('pagehide', () => {
    if (inside) sessionStorage.setItem(KEY, String(player.position));
    else sessionStorage.removeItem(KEY);
  });
}

if (q.get('wait') !== '1') await import('../../src/index.js');
