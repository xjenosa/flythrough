'use client';

// A direct child of <Flythrough> that comes or goes (a moment, the poster, a
// card) is another set of children: the component builds a new player, as
// it does for another set of cards. A page of its own (window.__way
// 'note'): test/examples-test.mjs presses both buttons.
import { useState } from 'react';
import { Flythrough } from 'flythrough/react';
import 'flythrough/style.css';

export function NoteApp() {
  const [note, setNote] = useState(false);
  const [poster, setPoster] = useState(false);

  return (
    <main>
      {/* #region note */}
      <Flythrough src="/tour/manifest.json">
        {poster && <img data-poster src="/tour/landscape/0049.webp" alt="" />}
        <h2 data-stop="entrance" data-frame="49">
          Entrance
        </h2>
        {/* Shown or hidden, a direct child makes a new player: the tour
            starts over. */}
        {note && (
          <p data-moment="note" data-from="0.1" data-to="0.15">
            Up the stairs
          </p>
        )}
        <h2 data-stop="lobby" data-frame="121">
          Lobby
        </h2>
      </Flythrough>
      {/* #endregion note */}
      <button type="button" className="note" onClick={() => setNote(!note)}>
        {note ? 'Hide the note' : 'Show the note'}
      </button>
      <button type="button" className="poster" onClick={() => setPoster(!poster)}>
        {poster ? 'No poster' : 'A poster'}
      </button>
    </main>
  );
}
