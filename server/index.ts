import { createApp } from './core.js';

const port = Number(process.env.PORT || '4317');
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必須介於 1 與 65535');
if (process.env.NODE_ENV !== 'production' && !['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.ALLOW_NETWORK !== 'true') throw new Error('本機模式預設僅允許 loopback；若有明確需要，設定 ALLOW_NETWORK=true');
const app = createApp();
app.server.listen(port, host, () => console.log(`GatherNote 0.1.0 listening on http://${host}:${port}`));
let closing = false;
const shutdown = () => { if (closing) return; closing = true; void app.close().then(() => { process.exitCode = 0; }); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
