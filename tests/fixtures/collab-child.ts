import { createApp } from '../../server/core.js';

const directory = process.argv[2]; const port = Number(process.argv[3]);
if (!directory || !Number.isInteger(port) || port < 32000 || port >= 48000) throw new Error('Invalid isolated CRDT test server arguments');
const app = createApp({ dataDir: directory, env: process.env, integrationHandler: async () => false });
app.server.listen(port, '127.0.0.1', () => process.send?.({ kind: 'ready', port }));
// Parent deliberately uses SIGKILL/TerminateProcess to test durability without shutdown flushes.
