import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomInt } from 'node:crypto';
import { createApp, validateConfiguration } from '../server/core.js';

interface ApiData {
  user: { id: string; name: string; email: string; avatar: string } | null;
  csrfToken: string; localAuthEnabled: boolean; googleConfigured: boolean;
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
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'gathernote-test-'));
  const env = { NODE_ENV: 'test', SESSION_SECRET: 'stable-test-secret-with-at-least-32-characters' };
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
