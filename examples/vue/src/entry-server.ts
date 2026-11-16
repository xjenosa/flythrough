// What a server (Nuxt) does with the page: render it to HTML with no window
// or document. test/examples-test.mjs calls this for each way.
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import App from './App.vue';
import PlainApp from './PlainApp.vue';

export const render = (way: 'component' | 'plain') => renderToString(createSSRApp(way === 'plain' ? PlainApp : App));
