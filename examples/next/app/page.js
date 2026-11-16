// A server component: Next renders the page's HTML on the server, cards
// included, and the browser takes it over. <Flythrough> is written here
// directly for the plain scrub (it has no handlers to pass); the tour keeps
// state, so it is a client component of its own (Tour.js).
import { Flythrough } from 'flythrough/react';
import 'flythrough/style.css';
import { Tour } from './Tour';

export default function Page() {
  return (
    <main>
      <Tour />
      <Flythrough src="/tour/manifest.json" length={6}>
        <p data-moment="line" data-from="0.1" data-to="0.4">
          One long shot
        </p>
      </Flythrough>
    </main>
  );
}
