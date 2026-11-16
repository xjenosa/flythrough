import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { flythroughFromSource } from '../from-source.mjs';

export default defineConfig({
  plugins: [
    // #region config
    // <fly-through> is a custom element, not a Vue component. In Nuxt the
    // same option is vue.compilerOptions.isCustomElement in nuxt.config.
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'fly-through' } } }),
    // #endregion config
  ],
  resolve: { alias: flythroughFromSource },
  server: { fs: { allow: ['../..'] } },
  // The demo's frames stand at /tour/ (the test serves them from there): a
  // picture written in a template (NoteApp's poster) is then a file Vite
  // knows of. Nothing is copied into the build.
  publicDir: '../../demo/public',
  build: { target: 'es2022', copyPublicDir: false },
});
