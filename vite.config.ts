import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api/ollama': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
      },
      '/api/gdelt': {
        target: 'https://api.gdeltproject.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/gdelt/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
