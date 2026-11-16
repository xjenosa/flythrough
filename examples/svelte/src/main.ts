// Svelte uses the plain <fly-through> element (App.svelte with Tour.svelte):
// Svelte sets attributes on a custom element, listens to its events and
// binds it as it does for any element, on a server-rendered page too, so a
// wrapper would add nothing. test/examples-test.mjs serves the page both
// rendered by the server (entry-server.ts), as SvelteKit does, and empty.
import { hydrate, mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app')!;
if (target.childElementCount) hydrate(App, { target });
else mount(App, { target });
