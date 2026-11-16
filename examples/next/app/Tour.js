'use client';

// The tour of examples/react/src/App.tsx, in a real Next project (app
// router, plain JavaScript) with flythrough installed as a package. A client
// component: it keeps state and passes event handlers.
// test/examples-test.mjs installs, builds, starts and drives the project.
import { useRef, useState } from 'react';
import { Flythrough } from 'flythrough/react';
import 'flythrough/style.css';

const FULL = [
  { id: 'entrance', at: 0.0668, label: 'Entrance' },
  { id: 'lobby', at: 0.1669, label: 'Lobby' },
  { id: 'room', at: 0.4339, label: 'Room' },
  { id: 'terrace', at: 0.6843, label: 'Terrace' },
  { id: 'overview', at: 1, label: 'Overview' },
];
const SHORT = [FULL[0], FULL[4]];

export function Tour() {
  const player = useRef(null);
  const [short, setShort] = useState(false);
  const [ready, setReady] = useState(false);
  const [at, setAt] = useState(null);
  const [bars, setBars] = useState(true);
  const stops = short ? SHORT : FULL;

  return (
    <>
      <Flythrough
        ref={player}
        src="/tour/manifest.json"
        intro
        bar={bars ? undefined : 'off'}
        onReady={() => setReady(true)}
        onStop={(e) => setAt(e.detail.active ? e.detail.id : null)}
      >
        {stops.map((s) => (
          <h2 key={s.id} data-stop={s.id} data-at={s.at} data-label={s.label}>
            {s.label}
          </h2>
        ))}
      </Flythrough>
      <p className="tour-status">{ready ? (at ?? 'between stops') : 'loading'}</p>
      <button type="button" onClick={() => player.current?.goToStop(0)}>
        Back to the first stop
      </button>
      <button type="button" className="bars" onClick={() => setBars(!bars)}>
        {bars ? 'Hide the bar' : 'Show the bar'}
      </button>
      <button
        type="button"
        className="switch"
        onClick={() => {
          setShort(!short);
          setReady(false);
        }}
      >
        {short ? 'The whole tour' : 'The short tour'}
      </button>
    </>
  );
}
