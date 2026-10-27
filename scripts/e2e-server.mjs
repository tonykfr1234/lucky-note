import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../build/server/core.js';
const dataDir = mkdtempSync(join(tmpdir(), 'luckynote-e2e-'));
const app = createApp({ dataDir, env: { NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:4318', SESSION_SECRET: 'test-only-not-a-deployment-secret-12345' } });
app.server.listen(4318, '127.0.0.1', () => console.log('LuckyNote isolated E2E server ready on 127.0.0.1:4318'));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await app.close(); rmSync(dataDir, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
