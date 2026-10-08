import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: '/storefront/',
  build: {
    commonjsOptions: { include: [/node_modules/, /shared/, /agent\/offer-policy/] },
    rollupOptions: {
      input: { storefront: fileURLToPath(new URL('./index.html', import.meta.url)), 'booking-wallet': fileURLToPath(new URL('./src/booking-wallet.ts', import.meta.url)) },
      output: { entryFileNames: (chunk) => chunk.name === 'booking-wallet' ? 'booking-wallet.js' : 'assets/[name]-[hash].js' },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/catalog': 'http://localhost:3001',
      '/parse-condition': 'http://localhost:3001',
      '/queue': 'http://localhost:3001',
      '/demo': 'http://localhost:3001',
      '/dashboard': 'http://localhost:3001',
      '/wallet': 'http://localhost:3001',
    },
  },
});
