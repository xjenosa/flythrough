// The Vite server every browser test of the host page uses (test/host/).
// noGsap: the whole run on the entry without GSAP. A page asked for with
// gsap=0 gets that entry too. Either way index.html is given the script of
// that entry (main-no-gsap.ts) in place of main.ts.
import { createServer } from 'vite';

export async function serveHost({ noGsap = false, plugins = [] } = {}) {
  const server = await createServer({
    root: 'test/host',
    publicDir: '../../demo/public',
    logLevel: 'warn',
    // By address, not as "localhost": under that name Playwright's Firefox
    // has taken 190 ms over every request (150 frames in 2.3 s, by address
    // 0.25 s), which fails every row that times a load. The examples test
    // names its servers the same way.
    server: { port: 0, host: '127.0.0.1' },
    plugins: [
      ...plugins,
      {
        name: 'host-entry',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, ctx) => (noGsap || /[?&]gsap=0\b/.test(ctx.originalUrl ?? '') ? html.replace('./main.ts', './main-no-gsap.ts') : html),
        },
      },
    ],
  });
  await server.listen();
  return server;
}
