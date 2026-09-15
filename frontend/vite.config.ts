import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'https://zy04-recording-mvp.onrender.com',
        changeOrigin: true,
        secure: false
      },
      '/sca': {
        target: process.env.VITE_BACKEND_URL || 'https://zy04-recording-mvp.onrender.com',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
