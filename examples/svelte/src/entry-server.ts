// What a server (SvelteKit) does with the page: render it to HTML with no
// window or document. test/examples-test.mjs calls this.
import { render as toHtml } from 'svelte/server';
import App from './App.svelte';

export const render = (_way: 'plain') => toHtml(App).body;
