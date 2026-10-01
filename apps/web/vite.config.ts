import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the build works from any sub-path, from a file server, and inside Capacitor.
  base: './',
  plugins: [preact()],
  // A taken port is an error, not a silent move to the next one: the docs and `pnpm dev` assume these ports.
  server: { port: 5173, strictPort: true },
  preview: { strictPort: true },
  build: { outDir: 'dist', sourcemap: true, target: 'es2023' },
});
