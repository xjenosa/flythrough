// What a server (Next, Remix) does with the page: render it to HTML with no
// window or document. test/examples-test.mjs calls this for each way.
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { PlainApp } from './PlainApp';

export const render = (way: 'component' | 'plain') => renderToString(way === 'plain' ? <PlainApp /> : <App />);
