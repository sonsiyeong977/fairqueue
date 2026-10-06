import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/storefront/',
  server: {
    port: 5173,
    proxy: {
      '/catalog': 'http://localhost:3001',
      '/parse-condition': 'http://localhost:3001',
      '/queue': 'http://localhost:3001',
      '/demo': 'http://localhost:3001',
      '/dashboard': 'http://localhost:3001',
    },
  },
});
