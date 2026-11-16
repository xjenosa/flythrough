// Two ways to use the player in Vue, each a page of its own: the
// <Flythrough> component (App.vue), and the plain <fly-through> element
// (PlainApp.vue with Tour.vue); and a third page for a child that comes
// and goes (NoteApp.vue). test/examples-test.mjs says which with
// window.__way, and serves each both rendered by the server
// (entry-server.ts), as Nuxt does, and empty, as a plain Vite project.
import { createApp, createSSRApp } from 'vue';
import App from './App.vue';
import PlainApp from './PlainApp.vue';
import NoteApp from './NoteApp.vue';

declare global {
  interface Window {
    __way?: 'component' | 'plain' | 'note';
  }
}

const page = window.__way === 'plain' ? PlainApp : window.__way === 'note' ? NoteApp : App;
const root = document.getElementById('app')!;
(root.childElementCount ? createSSRApp(page) : createApp(page)).mount(root);
