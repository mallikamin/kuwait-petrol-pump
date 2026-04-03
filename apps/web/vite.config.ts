import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

// Get git commit SHA for build tracking
const getBuildId = (): string => {
  try {
    const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
    const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return `${gitHash} (${buildDate})`;
  } catch {
    const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return `unknown (${buildDate})`;
  }
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    '__BUILD_ID__': JSON.stringify(getBuildId()),
  },
  server: {
    port: 3001,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        // Direct tunnel to backend container (bypasses nginx rate limits)
        target: 'http://127.0.0.1:38000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Remove Origin header to avoid CORS check (direct backend tunnel)
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
});
