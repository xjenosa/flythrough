'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Flythrough, Stop } from 'flythrough';
import type {} from 'flythrough/react';
import 'flythrough/style.css';

export function Tour({ src, stops, children }: { src: string; stops: Stop[]; children: ReactNode }) {
  const player = useRef<Flythrough>(null);
  const [ready, setReady] = useState(false);
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    // Loaded in the browser, after React has matched the page: the player
    // moves the cards into its own stage.
    void import('flythrough');
    // Listened to here, not as props: on a page the server rendered, React
    // does not bind a custom element's events.
    const el = player.current!;
    const off = new AbortController();
    el.addEventListener('flythrough-ready', () => setReady(true), { signal: off.signal });
    el.addEventListener('flythrough-stop', (e) => setAt(e.detail.active ? e.detail.id : null), { signal: off.signal });
    return () => off.abort();
  }, []);

  return (
    <>
      <fly-through ref={player} src={src} stops={JSON.stringify(stops)} intro>
        {children}
      </fly-through>
      <p className="tour-status">{ready ? (at ?? 'between stops') : 'loading'}</p>
      <button type="button" onClick={() => player.current?.goToStop(0)}>
        Back to the first stop
      </button>
    </>
  );
}
