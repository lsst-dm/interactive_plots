import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // The bundle is embedded in pages served from an unknown prefix (dp2.lsst.io
  // at the root, but /v/<branch>/ for previews), so nothing may be rooted at /.
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Unhashed: the bundle is committed to dp2_lsst_io, where a content
        // hash would make every rebuild a delete-plus-add of a new file and
        // leave the old one orphaned in _static/.
        entryFileNames: 'dp2-data-quality.js',
        assetFileNames: 'dp2-data-quality.[ext]',
      },
    },
  },
});
