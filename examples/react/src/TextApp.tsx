'use client';

// Bare text written directly inside <Flythrough> that comes or goes is
// another set of children too: the component builds a new player, as for a
// moment (NoteApp.tsx). The text stays where it is written, a line above the
// tour, so this player is not the first thing on its page: at the very top
// that line would be a gap the player warns about. A page of its own
// (window.__way 'text'): test/examples-test.mjs presses the button.
import { useState } from 'react';
import { Flythrough } from 'flythrough/react';
import 'flythrough/style.css';

export function TextApp() {
  const [hint, setHint] = useState(false);

  return (
    <main>
      <p>The tour starts below.</p>
      <Flythrough src="/tour/manifest.json">
        {hint && 'Scroll to fly'}
        <h2 data-stop="entrance" data-frame="49">
          Entrance
        </h2>
        <h2 data-stop="lobby" data-frame="121">
          Lobby
        </h2>
      </Flythrough>
      <button type="button" className="text" onClick={() => setHint(!hint)}>
        {hint ? 'Hide the hint' : 'Show the hint'}
      </button>
    </main>
  );
}
