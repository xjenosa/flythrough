'use client';

import { useState } from 'react';
import type { Stop } from 'flythrough';
import { Tour } from './Tour';

const FULL: Stop[] = [
  { id: 'entrance', at: 0.0668, label: 'Entrance' },
  { id: 'lobby', at: 0.1669, label: 'Lobby' },
  { id: 'room', at: 0.4339, label: 'Room' },
  { id: 'terrace', at: 0.6843, label: 'Terrace' },
  { id: 'overview', at: 1, label: 'Overview' },
];
const SHORT: Stop[] = [FULL[0], FULL[4]];

export function PlainApp() {
  const [short, setShort] = useState(false);
  const stops = short ? SHORT : FULL;

  return (
    <main>
      {/* #region usage */}
      {/* Another set of cards is another player: the key makes React
          build a new one (the player has moved the old cards). */}
      <Tour key={short ? 'short' : 'full'} src="/tour/manifest.json" stops={stops}>
        {stops.map((s) => (
          <h2 key={s.id} data-stop={s.id}>
            {s.label}
          </h2>
        ))}
      </Tour>
      <button type="button" className="switch" onClick={() => setShort(!short)}>
        {short ? 'The whole tour' : 'The short tour'}
      </button>

      {/* A plain scrub: no stops, one line passing by. A second player on a
          page needs nothing special. */}
      <fly-through src="/tour/manifest.json" length="6">
        <p data-moment="line" data-from="0.1" data-to="0.4">
          One long shot
        </p>
      </fly-through>
      {/* #endregion usage */}
    </main>
  );
}
