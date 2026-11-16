// Script of the page test/features-test.mjs serves in two parts (/stream),
// imported from its head: it runs, and so defines the player, while the
// element is in the page and its children are still to come. It then tells
// the server to send them.
import '../../src/index.js';

(window as any).__early = document.getElementById('player')!.childElementCount;
void fetch('/stream/go');
