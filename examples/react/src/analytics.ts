// The README's analytics recipe (cut from here by tools/snippets.mjs), run by
// test/examples-test.mjs on this example's page.
// #region analytics
// Tells an analytics tool which stops visitors reach: each stop once a
// visit, the first time its card shows, with how many they have reached.
export function reportStops(send: (stop: string, nth: number) => void) {
  const seen = new Set<string>();
  document.addEventListener('flythrough-stop', (e) => {
    const { id, active } = e.detail;
    if (!active || seen.has(id)) return;
    seen.add(id);
    send(id, seen.size);
  });
}
// #endregion analytics

declare global {
  interface Window {
    // Plausible's own function, when its script is on the page.
    plausible?: (event: string, options?: { props?: Record<string, string | number> }) => void;
  }
}
