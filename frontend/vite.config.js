import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3300,
    host: true,
    allowedHosts: ["sherlotracks.zgz.sherblog.es"],
    hmr: {
      host: 'sherlotracks.zgz.sherblog.es',
      clientPort: 80
    },
    watch: {
      usePolling: true
    },
    proxy: {
      '/api': {
        target: 'http://192.168.10.211:8800',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
