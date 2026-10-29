import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../data', import.meta.url));

export default defineConfig({
  base: './', // despliegue estático en cualquier subruta (GitHub Pages, Netlify, S3…)
  resolve: { alias: { '@data': dataDir } },
  server: {
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: { chunkSizeWarningLimit: 800 },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
