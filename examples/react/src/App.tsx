'use client';

// #region imports
import { useRef, useState } from 'react';
import { Flythrough, type FlythroughElement } from 'flythrough/react';
import 'flythrough/style.css';
// #endregion imports

const FULL = [
  { id: 'entrance', at: 0.0668, label: 'Entrance' },
  { id: 'lobby', at: 0.1669, label: 'Lobby' },
  { id: 'room', at: 0.4339, label: 'Room' },
  { id: 'terrace', at: 0.6843, label: 'Terrace' },
  { id: 'overview', at: 1, label: 'Overview' },
];
const SHORT = [FULL[0], FULL[4]];

export function App() {
  const player = useRef<FlythroughElement>(null);
  const [short, setShort] = useState(false);
  const [ready, setReady] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [bars, setBars] = useState(true);
  const stops = short ? SHORT : FULL;

  return (
    <main>
      {/* #region component */}
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
      {/* #endregion component */}

      {/* A prop changed while the player runs is live: the same player. */}
      <button type="button" className="bars" onClick={() => setBars(!bars)}>
        {bars ? 'Hide the bar' : 'Show the bar'}
      </button>

      {/* Other cards are another tour: the component builds a new player. */}
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

      {/* #region scrub */}
      {/* A plain scrub: no stops, one line passing by. */}
      <Flythrough src="/tour/manifest.json" length={6}>
        <p data-moment="line" data-from="0.1" data-to="0.4">
          One long shot
        </p>
      </Flythrough>
      {/* #endregion scrub */}
    </main>
  );
}
