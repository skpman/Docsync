import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:4000';
const SYNC = process.env.VITE_SYNC_PROXY ?? 'ws://localhost:4001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/sync': { target: SYNC, ws: true, changeOrigin: true },
    },
  },
});
