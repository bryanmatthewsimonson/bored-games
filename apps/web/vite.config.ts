import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the build works from any sub-path, from a file server, and inside Capacitor.
  base: './',
  plugins: [preact()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true, target: 'es2023' },
});
