import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BASE_PATH = process.env['VITE_BASE_PATH'] ?? '';
const API_TARGET = process.env['VITE_API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // base must end with '/' for correct asset resolution under a sub-path
  base: BASE_PATH ? `${BASE_PATH}/` : '/',
  server: {
    port: 5173,
    proxy: {
      [`${BASE_PATH}/auth`]: {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => (BASE_PATH ? path.replace(BASE_PATH, '') : path),
      },
      [`${BASE_PATH}/api`]: {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => (BASE_PATH ? path.replace(BASE_PATH, '') : path),
      },
    },
  },
});
