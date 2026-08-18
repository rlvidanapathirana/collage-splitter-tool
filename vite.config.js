import { defineConfig } from 'vite';

export default defineConfig({
  base: '/collage-splitter-tool/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
});
