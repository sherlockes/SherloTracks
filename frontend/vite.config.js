import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const allowedHostsEnv = process.env.VITE_ALLOWED_HOSTS || 'sherlotracks.zgz.sherblog.es,sherlotracks.tejelonsos.es';
const allowedHosts = allowedHostsEnv.split(',').map(h => h.trim());
const hmrHost = process.env.VITE_HMR_HOST || 'sherlotracks.tejelonsos.es';
const hmrPort = process.env.VITE_HMR_PORT ? parseInt(process.env.VITE_HMR_PORT) : 443;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3300,
    host: true,
    allowedHosts: allowedHosts,
    hmr: {
      host: hmrHost,
      clientPort: hmrPort
    },
    watch: {
      usePolling: true
    },
    proxy: {
      '/api': {
        target: 'http://sherlotracks-back:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
