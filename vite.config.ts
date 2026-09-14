import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        react: resolve(import.meta.dirname, 'src/react.tsx'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'gsap', 'ogl', 'wgpu-kit'],
    },
    sourcemap: true,
    minify: false,
  },
});
