// React needs no plugin here: Vite compiles the JSX itself.
import { defineConfig } from 'vite';
import { flythroughFromSource } from '../from-source.mjs';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: flythroughFromSource },
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
});
