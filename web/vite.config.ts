import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development (npm run dev) API calls go to a running Presentify stack.
const target = process.env.PRESENTIFY_DEV_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      // Staff application, and the small participant page (scan → register → view).
      input: { main: 'index.html', participant: 'm.html' },
    },
  },
  server: {
    proxy: Object.fromEntries(
      ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1', '/config.js'].map((p) => [p, { target, changeOrigin: false }]),
    ),
  },
});
