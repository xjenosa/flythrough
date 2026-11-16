import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { flythroughFromSource } from '../from-source.mjs';

export default defineConfig({
  plugins: [svelte({ configFile: false })],
  resolve: { alias: flythroughFromSource },
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
});
