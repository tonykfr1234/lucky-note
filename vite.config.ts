import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: mode === 'preview' ? '/lucky-note/' : '/',
  define: {
    'import.meta.env.VITE_LOCAL_MODE': JSON.stringify(mode === 'device' || mode === 'preview' ? 'true' : 'false'),
    'import.meta.env.VITE_DEMO_SEED': JSON.stringify(mode === 'preview' ? 'true' : 'false'),
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true, ws: true, configure(proxy) {
      proxy.on('proxyReq', (outgoing, incoming) => {
        if (incoming.headers.origin === 'http://127.0.0.1:5173') outgoing.setHeader('Origin', 'http://127.0.0.1:4317');
      });
      proxy.on('proxyReqWs', (outgoing, incoming) => {
        if (incoming.headers.origin === 'http://127.0.0.1:5173') outgoing.setHeader('Origin', 'http://127.0.0.1:4317');
      });
    } },
  } },
  build: { target: 'es2022', sourcemap: false, outDir: mode === 'device' ? 'dist-local' : mode === 'preview' ? 'dist-preview' : 'dist' },
}));
