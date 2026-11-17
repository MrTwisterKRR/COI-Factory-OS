import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/coi-live-api': {
        target: 'http://127.0.0.1:3073',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/coi-live-api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Strip Origin/Referer so vanilla web_api_start (even without allowOtherOrigins) accepts local proxy requests
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
          proxy.on('error', (err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  __coiOffline: true,
                  message: err.message || 'ECONNREFUSED',
                }),
              );
            }
          });
        },
      },
    },
  },
});
