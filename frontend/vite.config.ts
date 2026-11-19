import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In the Docker dev stack on Windows (and macOS), a save on the host sends no file-change event into the
    // container, so Vite kept serving the old module until restarted. docker-compose.yml sets this to poll instead.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    // Mirrors the nginx /api block in the production image, so the app calls a
    // same-origin /api in both dev and prod and never depends on CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
