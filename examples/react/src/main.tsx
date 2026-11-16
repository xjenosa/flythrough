// Two ways to use the player in React, each a page of its own: the
// <Flythrough> component (App.tsx), and the plain <fly-through> element
// (PlainApp.tsx with Tour.tsx); and two more pages for a child that comes
// and goes (NoteApp.tsx an element, TextApp.tsx bare text).
// test/examples-test.mjs says which with window.__way, and serves the first
// two both rendered by the server (entry-server.tsx), as Next does, and
// empty, as a plain Vite project.
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { PlainApp } from './PlainApp';
import { NoteApp } from './NoteApp';
import { TextApp } from './TextApp';
import { reportStops } from './analytics';

// #region analytics-use
reportStops((stop, nth) => window.plausible?.('Tour stop', { props: { stop, nth } }));
// #endregion analytics-use

// ?debug=1: the layout overlay, a separate import a site adds while
// laying out a tour (README, Laying out a tour).
if (new URLSearchParams(location.search).has('debug')) {
  document.addEventListener('flythrough-ready', () => void import('flythrough/debug').then(({ debug }) => debug()), { once: true });
}

declare global {
  interface Window {
    __way?: 'component' | 'plain' | 'note' | 'text';
  }
}

const page = window.__way === 'plain' ? <PlainApp /> : window.__way === 'note' ? <NoteApp /> : window.__way === 'text' ? <TextApp /> : <App />;
const root = document.getElementById('app')!;
if (root.childElementCount) hydrateRoot(root, page);
else createRoot(root).render(page);
