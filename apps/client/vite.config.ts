import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento, a API e o socket são repassados para o servidor na porta 3001.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // A biblioteca 3D vai em um arquivo separado, que o navegador guarda em cache.
        manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'] },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
