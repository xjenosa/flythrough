// Demo site: `npm run demo` serves it, `npm run demo:build` writes demo/dist
// for deploying. Relative base, so it works from any path.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
