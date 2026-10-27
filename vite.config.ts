import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true, configure(proxy) {
      proxy.on('proxyReq', (outgoing, incoming) => {
        if (incoming.headers.origin === 'http://127.0.0.1:5173') outgoing.setHeader('Origin', 'http://127.0.0.1:4317');
      });
    } },
  } },
  build: { target: 'es2022', sourcemap: false },
});
