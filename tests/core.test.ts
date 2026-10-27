import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { randomInt } from 'node:crypto';
import { createApp, validateConfiguration } from '../server/core.js';

interface ApiData {
  user: { id: string; name: string; email: string; avatar: string; emailVerified: boolean; identityProvider: string } | null;
  csrfToken: string; localAuthEnabled: boolean; googleConfigured: boolean; sharingIdentityPolicy: string;
  workspaces: { id: string; name: string; type: string; role: string }[];
  workspace: { id: string; name: string; type: string; role: string };
  note: { id: string; workspaceId: string; title: string; content: string; tags: string[]; version: number; notebookId: string | null };
  notes: ApiData['note'][]; notebook: { id: string; name: string };
  attachment: { id: string; name: string; mime: string; size: number; url: string };
  attachments: ApiData['attachment'][];
  expenses: { id: string; amount: number; participantIds: string[] }[];
  expense: { id: string; amount: number };
  balances: { userId: string; balance: number }[];
  settlements: { from: string; to: string; amount: number }[];
  confirmations: { id: string; status: string }[];
  members: { id: string; role: string }[];
  notebooks: { id: string; name: string }[];
  id: string; status: string; format: string; formatVersion: number; attachmentsIncluded: boolean;
  imported: number; error: string; code: string;
}
class Client {
  cookie = ''; csrf = '';
  constructor(public origin: string) {}
  async call(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { Cookie: this.cookie, ...extraHeaders };
    if (method !== 'GET' && method !== 'HEAD') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = this.csrf; }
    const response = await fetch(this.origin + path, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body || {}) });
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0]!;
    const data = await response.json() as ApiData;
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }
  async register(name: string) { const result = await this.call('/api/auth/register', 'POST', { name, email: `${name}@example.test`, password: 'correct horse battery' }); assert.equal(result.status, 201); return result.data.user!; }
  async privateWorkspace() { return (await this.call('/api/workspaces')).data.workspaces.find((w) => w.type === 'private')!.id; }
  async group() { const result = await this.call('/api/workspaces', 'POST', { name: '旅遊群組', type: 'group' }); assert.equal(result.status, 201); return result.data.workspace.id; }
  async note(workspaceId: string, mutationId = 'note-1') { const result = await this.call(`/api/workspaces/${workspaceId}/notes`, 'POST', { title: '旅行清單', content: '- [ ] 雨傘\n- [ ] 充電器', tags: ['旅行'], clientMutationId: mutationId }); assert.equal(result.status, 201); return result.data.note; }
}
async function listenTestServer(server: Server): Promise<void> {
  // Windows in this execution environment can assign a fetch-blocked low port for listen(0).
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready); server.listen(randomInt(32000, 48000), '127.0.0.1');
      }); return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 7) throw error; }
  }
}
async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gathernote-test-'));
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', SESSION_SECRET: 'stable-test-secret-with-at-least-32-characters', ...overrides };
  const app = createApp({ dataDir: directory, env, integrationHandler: async () => false });
  await listenTestServer(app.server);
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, directory, env, origin, alice: new Client(origin), bob: new Client(origin), carol: new Client(origin), cleanup: async () => { await app.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoQAAAAASUVORK5CYII=';

test('registration, empty states, password validation, session flags and logout', async () => {
  const f = await fixture();
  try {
    const initial = await f.alice.call('/api/session'); assert.equal(initial.data.user, null); assert.equal(initial.data.googleConfigured, false); assert.equal(initial.data.localAuthEnabled, true);
    assert.equal((await f.alice.call('/api/workspaces')).status, 401);
    assert.equal((await f.alice.call('/api/auth/register', 'POST', { name: 'Alice', email: 'alice@example.test', password: 'short' })).status, 400);
    await f.alice.register('alice'); const id = await f.alice.privateWorkspace();
    assert.deepEqual((await f.alice.call(`/api/workspaces/${id}/notes`)).data.notes, []);
    assert.deepEqual((await f.alice.call(`/api/workspaces/${id}/expenses`)).data.expenses, []);
    assert.match(f.alice.cookie, /^gn_session=/); assert.ok(f.alice.csrf.length >= 32);
    assert.equal((await f.alice.call('/api/auth/logout', 'POST')).status, 200);
    assert.equal((await f.alice.call('/api/workspaces')).status, 401);
    assert.equal((await f.alice.call('/api/auth/login', 'POST', { email: 'alice@example.test', password: 'incorrect password' })).status, 401);
    assert.equal((await f.alice.call('/api/auth/login', 'POST', { email: 'alice@example.test', password: 'correct horse battery' })).status, 200);
  } finally { await f.cleanup(); }
});

test('private and other-group notes, files, export, members, events and expenses are inaccessible', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); await f.bob.register('bob');
    const privateId = await f.alice.privateWorkspace(); const group = await f.alice.group();
    const privateNote = await f.alice.note(privateId); const groupNote = await f.alice.note(group);
    const upload = await f.alice.call(`/api/notes/${privateNote.id}/attachments`, 'POST', { name: 'photo.png', mime: 'image/png', data: tinyPng, clientMutationId: 'png-1' }); assert.equal(upload.status, 201);
    for (const path of [`/api/workspaces/${privateId}/notes`, `/api/workspaces/${group}/notes`, `/api/workspaces/${group}/members`, `/api/workspaces/${group}/expenses`, `/api/workspaces/${group}/export`, `/api/workspaces/${group}/events`, `/api/notes/${privateNote.id}`, `/api/notes/${groupNote.id}`, `/api/notes/${privateNote.id}/attachments`, upload.data.attachment.url]) {
      assert.equal((await f.bob.call(path)).status, 404, path);
    }
    assert.equal((await f.bob.call(`/api/notes/${privateNote.id}`, 'PATCH', { title: 'hacked', version: 1 })).status, 404);
    assert.equal((await f.bob.call(`/api/attachments/${upload.data.attachment.id}`, 'DELETE')).status, 404);
    assert.equal((await f.alice.call(`/api/workspaces/${privateId}/members`, 'POST', { email: 'bob@example.test', role: 'editor' })).status, 403);
  } finally { await f.cleanup(); }
});

test('viewer cannot mutate; owner can change roles and revoke membership immediately', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const bob = await f.bob.register('bob'); const group = await f.alice.group(); const note = await f.alice.note(group);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'bob@example.test', role: 'viewer' })).status, 200);
    assert.equal((await f.bob.call(`/api/notes/${note.id}`)).status, 200);
    assert.equal((await f.bob.call(`/api/notes/${note.id}`, 'PATCH', { content: 'write denied', version: 1 })).status, 403);
    assert.equal((await f.bob.call(`/api/workspaces/${group}/members`, 'POST', { email: 'alice@example.test', role: 'viewer' })).status, 403);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'bob@example.test', role: 'editor' })).status, 200);
    assert.equal((await f.bob.call(`/api/notes/${note.id}`, 'PATCH', { content: 'editor update', version: 1 })).status, 200);
    assert.equal((await f.bob.call(`/api/workspaces/${group}/members`, 'POST', { email: 'alice@example.test', role: 'viewer' })).status, 403);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/members/${bob.id}`, 'DELETE')).status, 200);
    assert.equal((await f.bob.call(`/api/notes/${note.id}`)).status, 404);
  } finally { await f.cleanup(); }
});

test('optimistic concurrency does not overwrite a more recent edit or delete a new version', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const note = await f.alice.note(await f.alice.privateWorkspace());
    const save = await f.alice.call(`/api/notes/${note.id}`, 'PATCH', { content: 'newest', version: 1 }); assert.equal(save.status, 200); assert.equal(save.data.note.version, 2);
    const stale = await f.alice.call(`/api/notes/${note.id}`, 'PATCH', { content: 'stale', version: 1 }); assert.equal(stale.status, 409); assert.equal(stale.data.code, 'VERSION_CONFLICT');
    assert.equal((await f.alice.call(`/api/notes/${note.id}`, 'DELETE', { version: 1 })).status, 409);
    assert.equal((await f.alice.call(`/api/notes/${note.id}`)).data.note.content, 'newest');
  } finally { await f.cleanup(); }
});

test('creation and notebook creation deduplicate; changing an idempotency payload is rejected', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const workspace = await f.alice.privateWorkspace();
    const first = await f.alice.note(workspace); const second = await f.alice.note(workspace); assert.equal(first.id, second.id);
    assert.equal((await f.alice.call(`/api/workspaces/${workspace}/notes`)).data.notes.length, 1);
    const bad = await f.alice.call(`/api/workspaces/${workspace}/notes`, 'POST', { title: 'Different', clientMutationId: 'note-1' }); assert.equal(bad.status, 409);
    const book1 = await f.alice.call(`/api/workspaces/${workspace}/notebooks`, 'POST', { name: '旅遊' });
    const book2 = await f.alice.call(`/api/workspaces/${workspace}/notebooks`, 'POST', { name: '旅遊' }); assert.equal(book1.data.notebook.id, book2.data.notebook.id);
  } finally { await f.cleanup(); }
});

test('notebook cannot cross workspace boundary even for an owner of both', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const privateId = await f.alice.privateWorkspace(); const group = await f.alice.group();
    const notebook = (await f.alice.call(`/api/workspaces/${privateId}/notebooks`, 'POST', { name: '私人' })).data.notebook;
    const result = await f.alice.call(`/api/workspaces/${group}/notes`, 'POST', { title: 'leak?', notebookId: notebook.id, clientMutationId: 'cross-1' }); assert.equal(result.status, 400); assert.equal(result.data.code, 'NOTEBOOK_SCOPE');
    assert.deepEqual((await f.alice.call(`/api/workspaces/${group}/notes`)).data.notes, []);
  } finally { await f.cleanup(); }
});

test('attachments validate MIME/signature, deduplicate, serve range with ACL and remove with note', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const note = await f.alice.note(await f.alice.privateWorkspace()); const path = `/api/notes/${note.id}/attachments`;
    assert.equal((await f.alice.call(path, 'POST', { name: 'x.svg', mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64'), clientMutationId: 'bad-1' })).status, 415);
    assert.equal((await f.alice.call(path, 'POST', { name: 'x.png', mime: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64'), clientMutationId: 'bad-2' })).status, 415);
    const payload = { name: '../photo.png', mime: 'image/png', data: tinyPng, clientMutationId: 'file-1' };
    const first = await f.alice.call(path, 'POST', payload); const again = await f.alice.call(path, 'POST', payload); assert.equal(first.status, 201); assert.equal(first.data.attachment.id, again.data.attachment.id);
    assert.equal((await f.alice.call(path)).data.attachments.length, 1);
    const response = await fetch(f.origin + first.data.attachment.url, { headers: { Cookie: f.alice.cookie, Range: 'bytes=0-7' } }); assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.arrayBuffer()).byteLength, 8);
    assert.equal((await fetch(f.origin + first.data.attachment.url)).status, 401);
    assert.equal((await f.alice.call(`/api/notes/${note.id}`, 'DELETE', { version: 1 })).status, 200);
    assert.equal((await f.alice.call(first.data.attachment.url)).status, 404);
  } finally { await f.cleanup(); }
});

test('CSRF and malicious Origin are rejected while same-origin requests work', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice');
    const noCsrf = await fetch(f.origin + '/api/workspaces', { method: 'POST', headers: { Cookie: f.alice.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'bad', type: 'group' }) }); assert.equal(noCsrf.status, 403);
    assert.equal((await f.alice.call('/api/workspaces', 'POST', { name: 'bad', type: 'group' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.alice.call('/api/workspaces', 'POST', { name: 'good', type: 'group' }, { Origin: f.origin })).status, 201);
    const noJson = await fetch(f.origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }); assert.equal(noJson.status, 415);
  } finally { await f.cleanup(); }
});

test('integer expense split conserves total, is deterministic and rejects foreign members/currency', async () => {
  const f = await fixture();
  try {
    const alice = await f.alice.register('alice'); const bob = await f.bob.register('bob'); const carol = await f.carol.register('carol'); const group = await f.alice.group();
    await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'bob@example.test', role: 'editor' });
    const payload = { description: 'Lunch', amount: 101, payerId: alice.id, participantIds: [bob.id, alice.id], clientMutationId: 'expense-1' };
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', payload)).status, 201);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', payload)).status, 201);
    const summary = (await f.alice.call(`/api/workspaces/${group}/expenses`)).data; assert.equal(summary.expenses.length, 1); assert.equal(summary.balances.reduce((total, item) => total + item.balance, 0), 0); assert.equal(summary.settlements.length, 1); assert.ok([50, 51].includes(summary.settlements[0]!.amount));
    assert.deepEqual((await f.alice.call(`/api/workspaces/${group}/expenses`)).data.balances, summary.balances);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', { ...payload, participantIds: [alice.id, carol.id], clientMutationId: 'foreign' })).status, 400);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', { ...payload, amount: 1.5, clientMutationId: 'fraction' })).status, 400);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', { ...payload, currency: 'USD', clientMutationId: 'currency' })).status, 400);
  } finally { await f.cleanup(); }
});

test('settlement only changes balances after recipient confirms, and repeated confirm is harmless', async () => {
  const f = await fixture();
  try {
    const alice = await f.alice.register('alice'); const bob = await f.bob.register('bob'); const group = await f.alice.group();
    await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'bob@example.test', role: 'editor' });
    await f.alice.call(`/api/workspaces/${group}/expenses`, 'POST', { description: 'meal', amount: 100, payerId: alice.id, participantIds: [alice.id, bob.id], clientMutationId: 'meal-1' });
    const confirmation = await f.bob.call(`/api/workspaces/${group}/settlements`, 'POST', { toId: alice.id, amount: 50, clientMutationId: 'paid-1' }); assert.equal(confirmation.status, 201);
    assert.equal((await f.alice.call(`/api/workspaces/${group}/expenses`)).data.settlements.length, 1);
    const path = `/api/workspaces/${group}/settlements/${confirmation.data.id}`;
    assert.equal((await f.bob.call(path, 'PATCH', { status: 'confirmed' })).status, 403);
    assert.equal((await f.alice.call(path, 'PATCH', { status: 'confirmed' })).status, 200);
    assert.equal((await f.alice.call(path, 'PATCH', { status: 'confirmed' })).status, 200);
    assert.deepEqual((await f.alice.call(`/api/workspaces/${group}/expenses`)).data.settlements, []);
  } finally { await f.cleanup(); }
});

test('export/import restores notes and notebooks once, excludes secrets and rolls back invalid archive', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const original = await f.alice.privateWorkspace(); const destination = await f.alice.group();
    const book = (await f.alice.call(`/api/workspaces/${original}/notebooks`, 'POST', { name: '旅行' })).data.notebook;
    const note = await f.alice.note(original); await f.alice.call(`/api/notes/${note.id}`, 'PATCH', { notebookId: book.id, version: 1 });
    const archive = (await f.alice.call(`/api/workspaces/${original}/export`)).data;
    assert.equal(archive.format, 'gathernote-workspace'); assert.equal(archive.attachmentsIncluded, false); assert.ok(!JSON.stringify(archive).includes('password')); assert.ok(!JSON.stringify(archive).includes('csrf'));
    const payload = { archive, clientMutationId: 'import-1' };
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/import`, 'POST', payload)).data.imported, 1);
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/import`, 'POST', payload)).data.imported, 1);
    const imported = (await f.alice.call(`/api/workspaces/${destination}/notes`)).data.notes; assert.equal(imported.length, 1); assert.equal(imported[0]!.content, note.content); assert.notEqual(imported[0]!.notebookId, book.id);
    const invalid = { ...archive, notebooks: [{ id: 'x', name: 'Should roll back' }], notes: [{ title: 'Bad', notebookId: 'missing' }] };
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/import`, 'POST', { archive: invalid, clientMutationId: 'bad-import' })).status, 400);
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/notebooks`)).data.notebooks.length, 1);
  } finally { await f.cleanup(); }
});

test('SSE delivers edits to an authorized member and closes when membership is revoked', async () => {
  const f = await fixture();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await f.alice.register('alice'); const bob = await f.bob.register('bob'); const group = await f.alice.group();
    await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'bob@example.test', role: 'viewer' });
    const stream = await fetch(`${f.origin}/api/workspaces/${group}/events`, { headers: { Cookie: f.bob.cookie } }); assert.equal(stream.status, 200);
    reader = stream.body!.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
    await f.alice.note(group); assert.match(new TextDecoder().decode((await reader.read()).value), /notes/);
    await f.alice.call(`/api/workspaces/${group}/members/${bob.id}`, 'DELETE');
    const end = await Promise.race([reader.read(), new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error('SSE did not close')), 3000); timeout.unref(); })]); assert.equal(end.done, true);
  } finally { await reader?.cancel(); await f.cleanup(); }
});

test('notes, attachments and idempotency survive server restart with no duplicate records', async () => {
  const f = await fixture();
  let second: ReturnType<typeof createApp> | undefined;
  try {
    await f.alice.register('alice'); const workspace = await f.alice.privateWorkspace(); const original = await f.alice.note(workspace);
    const file = (await f.alice.call(`/api/notes/${original.id}/attachments`, 'POST', { name: 'image.png', mime: 'image/png', data: tinyPng, clientMutationId: 'restart-file' })).data.attachment;
    await f.app.close();
    second = createApp({ dataDir: f.directory, env: f.env, integrationHandler: async () => false }); await listenTestServer(second.server);
    f.alice.origin = `http://127.0.0.1:${(second.server.address() as AddressInfo).port}`;
    assert.equal((await f.alice.call(`/api/notes/${original.id}`)).data.note.content, original.content);
    assert.equal((await f.alice.note(workspace)).id, original.id);
    assert.equal((await f.alice.call(`/api/workspaces/${workspace}/notes`)).data.notes.length, 1);
    const downloaded = await fetch(f.alice.origin + file.url, { headers: { Cookie: f.alice.cookie } }); assert.equal(downloaded.status, 200); assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString('base64'), tinyPng);
  } finally { if (second) await second.close(); else await f.app.close(); rmSync(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('production configuration fails closed; local-auth requires explicit production opt-in', () => {
  assert.throws(() => validateConfiguration({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  const base = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) };
  assert.throws(() => validateConfiguration(base), /APP_ORIGIN/);
  assert.throws(() => validateConfiguration({ ...base, APP_ORIGIN: 'http://example.com' }), /APP_ORIGIN/);
  const secure = { ...base, APP_ORIGIN: 'https://example.com' };
  assert.throws(() => validateConfiguration(secure), /Google/);
  assert.throws(() => validateConfiguration({ ...secure, AUTH_MODE: 'google' }), /GOOGLE_CLIENT_ID/);
  assert.doesNotThrow(() => validateConfiguration({ ...secure, AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'configured-id', GOOGLE_CLIENT_SECRET: 'configured-secret' }));
  assert.doesNotThrow(() => validateConfiguration({ ...secure, AUTH_MODE: 'local', ALLOW_LOCAL_AUTH: 'true' }));
});

test('CSP explicitly permits only the exact same-origin websocket, including HTTPS production', async () => {
  const f = await fixture();
  let secure: ReturnType<typeof createApp> | undefined;
  const secureDirectory = mkdtempSync(join(tmpdir(), 'gathernote-csp-test-'));
  try {
    const response = await f.alice.call('/api/health');
    assert.ok(response.headers.get('content-security-policy')?.includes(`connect-src 'self' ${f.origin.replace('http:', 'ws:')};`));
    // Native fetch normalizes Host, so use the HTTP client to exercise an actually spoofed header.
    const spoofedCsp = await new Promise<string>((resolve, reject) => {
      const call = request(`${f.origin}/api/health`, { headers: { Host: 'malicious.example' } }, response => {
        response.resume(); response.on('end', () => resolve(String(response.headers['content-security-policy'] || '')));
      });
      call.on('error', reject); call.end();
    });
    assert.ok(spoofedCsp.includes("connect-src 'self';"));
    assert.ok(!spoofedCsp.includes('malicious.example'));
    secure = createApp({ dataDir: secureDirectory, env: { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), APP_ORIGIN: 'https://notes.example.test', AUTH_MODE: 'local', ALLOW_LOCAL_AUTH: 'true' }, integrationHandler: async () => false });
    await listenTestServer(secure.server);
    const secureResponse = await fetch(`http://127.0.0.1:${(secure.server.address() as AddressInfo).port}/api/health`);
    assert.ok(secureResponse.headers.get('content-security-policy')?.includes("connect-src 'self' wss://notes.example.test;"));
    assert.ok(!secureResponse.headers.get('content-security-policy')?.includes('ws:;'));
  } finally { await secure?.close(); rmSync(secureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await f.cleanup(); }
});

test('large handwritten content and plain HTML-like text round-trip without server execution', async () => {
  const f = await fixture();
  try {
    await f.alice.register('alice'); const note = await f.alice.note(await f.alice.privateWorkspace());
    const content = '<script>nothing executes</script>\n' + 'x'.repeat(300000);
    assert.equal((await f.alice.call(`/api/notes/${note.id}`, 'PATCH', { content, version: 1 })).status, 200);
    assert.equal((await f.alice.call(`/api/notes/${note.id}`)).data.note.content, content);
    assert.equal((await f.alice.call(`/api/notes/${note.id}`, 'PATCH', { content: 'x'.repeat(524289), version: 2 })).status, 400);
  } finally { await f.cleanup(); }
});

test('production email squatting cannot enter a group, including memberships imported from local development', async () => {
  const f = await fixture({ NODE_ENV: 'production', APP_ORIGIN: 'https://notes.example.test', AUTH_MODE: 'local', ALLOW_LOCAL_AUTH: 'true' });
  try {
    const owner = await f.alice.register('verified-owner');
    const claimed = await f.bob.call('/api/auth/register', 'POST', { name: 'Attacker', email: 'victim@example.test', password: 'attacker test password', emailVerified: true, google_sub: 'forged' });
    assert.equal(claimed.status, 201); assert.equal(claimed.data.user!.emailVerified, false); assert.equal(claimed.data.user!.identityProvider, 'local');
    const other = await f.carol.register('verified-friend');
    // Stand in for identities established only by the separately tested verified OIDC callback.
    f.app.db.prepare('UPDATE users SET google_sub=? WHERE id=?').run('verified-google-owner-sub', owner.id);
    f.app.db.prepare('UPDATE users SET google_sub=? WHERE id=?').run('verified-google-friend-sub', other.id);
    const group = await f.alice.group(); const note = await f.alice.note(group);
    assert.equal((await f.alice.call('/api/session')).data.sharingIdentityPolicy, 'google-verified-only');
    assert.equal((await f.alice.call('/api/session')).data.user!.emailVerified, true);
    const invited = await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'victim@example.test', role: 'editor' });
    assert.equal(invited.status, 403); assert.equal(invited.data.code, 'VERIFIED_IDENTITY_REQUIRED');
    assert.equal((await f.bob.call(`/api/notes/${note.id}`)).status, 404);
    f.app.db.prepare('INSERT INTO members VALUES(?,?,?)').run(group, claimed.data.user!.id, 'editor');
    for (const path of [`/api/notes/${note.id}`, `/api/notes/${note.id}/collaboration`, `/api/workspaces/${group}/events`, `/api/workspaces/${group}/export`]) assert.equal((await f.bob.call(path)).status, 404);
    assert.ok(!(await f.bob.call('/api/workspaces')).data.workspaces.some(row => row.id === group));
    assert.equal((await f.alice.call(`/api/workspaces/${group}/members`, 'POST', { email: 'verified-friend@example.test', role: 'viewer' })).status, 200);
    assert.equal((await f.carol.call(`/api/notes/${note.id}`)).status, 200);
    const localGroup = await f.bob.group();
    assert.equal((await f.bob.call(`/api/workspaces/${localGroup}/members`, 'POST', { email: 'verified-friend@example.test', role: 'viewer' })).status, 403);
  } finally { await f.cleanup(); }
});

test('mutation caches contain no note text and deletion tombstones prevent replay resurrection after restart', async () => {
  const f = await fixture(); let restarted: ReturnType<typeof createApp> | undefined;
  try {
    await f.alice.register('cache-owner'); const workspace = await f.alice.privateWorkspace();
    const payload = { title: 'Private cache title', content: 'UNIQUE_PRIVATE_CONTENT_TO_ERASE', clientMutationId: 'erase-note' };
    const created = await f.alice.call(`/api/workspaces/${workspace}/notes`, 'POST', payload); const note = created.data.note;
    assert.equal(created.status, 201);
    let cache = JSON.stringify(f.app.db.prepare('SELECT * FROM mutations').all());
    assert.ok(!cache.includes(payload.title)); assert.ok(!cache.includes(payload.content));
    const archive = (await f.alice.call(`/api/workspaces/${workspace}/export`)).data;
    const destination = await f.alice.group(); const importBody = { archive, clientMutationId: 'erase-import' };
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/import`, 'POST', importBody)).status, 201);
    const imported = (await f.alice.call(`/api/workspaces/${destination}/notes`)).data.notes[0]!;
    f.app.db.exec('CREATE TABLE integration_previews(id TEXT PRIMARY KEY,provider TEXT,workspace_id TEXT,payload TEXT)');
    f.app.db.prepare('INSERT INTO integration_previews VALUES(?,?,?,?)').run('linked-ai-preview', 'ai', workspace, JSON.stringify({ items: [{ noteId: note.id, title: payload.title }] }));
    f.app.db.prepare('INSERT INTO integration_previews VALUES(?,?,?,?)').run('unrelated-external-operation', 'line', workspace, JSON.stringify({ text: 'User supplied independent message', status: 'uncertain' }));
    assert.equal((await f.alice.call(`/api/notes/${note.id}`, 'DELETE', { version: note.version })).status, 200);
    assert.equal(f.app.db.prepare('SELECT id FROM integration_previews WHERE id=?').get('linked-ai-preview'), undefined);
    assert.ok(f.app.db.prepare('SELECT id FROM integration_previews WHERE id=?').get('unrelated-external-operation'));
    assert.equal((await f.alice.call(`/api/notes/${imported.id}`, 'DELETE', { version: imported.version })).status, 200);
    cache = JSON.stringify(f.app.db.prepare('SELECT * FROM mutations').all());
    assert.ok(!cache.includes(payload.content)); assert.ok(!cache.includes(payload.title)); assert.ok(cache.includes('deleted'));
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS count FROM notes WHERE content LIKE ?').get(`%${payload.content}%`)!.count, 0);
    const retried = await f.alice.call(`/api/workspaces/${workspace}/notes`, 'POST', payload); assert.equal(retried.status, 410); assert.equal(retried.data.code, 'RESOURCE_DELETED');
    assert.equal((await f.alice.call(`/api/workspaces/${destination}/import`, 'POST', importBody)).status, 201);
    assert.deepEqual((await f.alice.call(`/api/workspaces/${destination}/notes`)).data.notes, []);
    await f.app.close();
    restarted = createApp({ dataDir: f.directory, env: f.env, integrationHandler: async () => false }); await listenTestServer(restarted.server);
    f.alice.origin = `http://127.0.0.1:${(restarted.server.address() as AddressInfo).port}`;
    assert.equal((await f.alice.call(`/api/workspaces/${workspace}/notes`, 'POST', payload)).status, 410);
    assert.deepEqual((await f.alice.call(`/api/workspaces/${workspace}/notes`)).data.notes, []);
  } finally { await restarted?.close(); await f.cleanup(); }
});

test('legacy full mutation responses are minimized on startup and deleted resources stay gone', async () => {
  const f = await fixture(); let restarted: ReturnType<typeof createApp> | undefined;
  try {
    await f.alice.register('legacy-cache'); const workspace = await f.alice.privateWorkspace(); const note = await f.alice.note(workspace);
    f.app.db.prepare('UPDATE mutations SET response=?,resource_id=NULL').run(JSON.stringify({ note }));
    f.app.db.prepare('DELETE FROM notes WHERE id=?').run(note.id); await f.app.close();
    restarted = createApp({ dataDir: f.directory, env: f.env, integrationHandler: async () => false }); await listenTestServer(restarted.server);
    f.alice.origin = `http://127.0.0.1:${(restarted.server.address() as AddressInfo).port}`;
    assert.ok(!JSON.stringify(restarted.db.prepare('SELECT * FROM mutations').all()).includes(note.content));
    const replay = await f.alice.call(`/api/workspaces/${workspace}/notes`, 'POST', { title: note.title, content: note.content, tags: note.tags, clientMutationId: 'note-1' });
    assert.equal(replay.status, 410); assert.deepEqual((await f.alice.call(`/api/workspaces/${workspace}/notes`)).data.notes, []);
  } finally { await restarted?.close(); await f.cleanup(); }
});

test('auth limiting isolates accounts behind one proxy and ignores forged forwarding headers', async () => {
  const f = await fixture();
  try {
    await f.alice.register('rate-good'); const anonymous = new Client(f.origin);
    for (let index = 0; index < 30; index++) {
      const attempt = await anonymous.call('/api/auth/login', 'POST', { email: 'attacked@example.test', password: 'wrong test password' }, { 'X-Forwarded-For': `203.0.113.${index}` });
      assert.equal(attempt.status, 401);
    }
    assert.equal((await anonymous.call('/api/auth/login', 'POST', { email: 'attacked@example.test', password: 'wrong test password' }, { 'X-Forwarded-For': '198.51.100.123' })).status, 429);
    assert.equal((await anonymous.call('/api/auth/login', 'POST', { email: 'rate-good@example.test', password: 'correct horse battery' })).status, 200);
  } finally { await f.cleanup(); }
});
