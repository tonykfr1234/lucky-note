import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, type ChildProcess } from 'node:child_process';
import { randomInt, createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createApp } from '../server/core.js';
import { NOTE_LIMITS } from '../shared/editor-schema.js';

type Json = Record<string, any>;
const secret = 'collaboration-tests-stable-session-secret-0123456789';
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function until(predicate: () => boolean, message: string, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail(message); await delay(15); }
}
class Account {
  cookie = ''; csrf = ''; id = '';
  constructor(public origin: string, public requestOrigin = origin) {}
  async api(path: string, method = 'GET', body?: Json) {
    const response = await fetch(this.origin + path, {
      method,
      headers: { Cookie: this.cookie, Origin: this.requestOrigin, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }) },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0]!;
    const data = await response.json() as Json;
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  async register(name: string) {
    const result = await this.api('/api/auth/register', 'POST', { name, email: `${name}@example.test`, password: 'strong local test password' });
    assert.equal(result.status, 201); this.id = result.data.user.id as string; return this;
  }
  async privateWorkspace() { const result = await this.api('/api/workspaces'); return (result.data.workspaces as Json[]).find((w) => w.type === 'private')!.id as string; }
  async group() { const result = await this.api('/api/workspaces', 'POST', { name: 'CRDT group', type: 'group' }); assert.equal(result.status, 201); return result.data.workspace.id as string; }
  async note(workspaceId: string, content = 'ABCD') {
    const result = await this.api(`/api/workspaces/${workspaceId}/notes`, 'POST', { title: 'Collaboration test', content, tags: [], clientMutationId: `note-${Math.random()}` });
    assert.equal(result.status, 201); return result.data.note.id as string;
  }
  async addMember(workspaceId: string, name: string, role: 'editor' | 'viewer') {
    const result = await this.api(`/api/workspaces/${workspaceId}/members`, 'POST', { email: `${name}@example.test`, role }); assert.equal(result.status, 200);
  }
}
async function listen(server: Server) {
  for (let i = 0; i < 8; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', fail); resolve(); };
        server.once('error', fail); server.once('listening', ready); server.listen(randomInt(32000, 48000), '127.0.0.1');
      }); return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i === 7) throw error; }
  }
}
interface Peer { doc: Y.Doc; provider: HocuspocusProvider; transport: HocuspocusProviderWebsocket; closed: boolean; errors: string[]; destroy: () => void }
function peer(account: Account, noteId: string): Peer {
  class SessionSocket extends WebSocket {
    constructor(url: string) { super(url, { headers: { Cookie: account.cookie, Origin: account.requestOrigin } }); }
  }
  const doc = new Y.Doc();
  const transport = new HocuspocusProviderWebsocket({ url: account.origin.replace(/^http/, 'ws') + '/api/collaboration', WebSocketPolyfill: SessionSocket, autoConnect: false, maxAttempts: 1, messageReconnectTimeout: 60000 });
  const result = { doc, transport, closed: false, errors: [] as string[] } as Peer;
  const provider = new HocuspocusProvider({ name: noteId, document: doc, websocketProvider: transport, awareness: null, token: () => account.csrf, onClose: () => { result.closed = true; }, onAuthenticationFailed: ({ reason }) => { result.errors.push(reason); } });
  result.provider = provider;
  result.destroy = () => { provider.destroy(); transport.destroy(); doc.destroy(); };
  provider.attach();
  void transport.connect().catch((error: unknown) => { result.errors.push(String(error)); });
  return result;
}
async function synced(item: Peer) { await until(() => item.provider.synced && item.provider.isAuthenticated, `Provider did not sync: ${item.errors.join(', ')}`); }
function xml(item: Peer | Y.Doc) { const doc = item instanceof Y.Doc ? item : item.doc; return doc.getXmlFragment('content').toString(); }
function text(item: Peer | Y.Doc): Y.XmlText {
  const doc = item instanceof Y.Doc ? item : item.doc;
  const paragraph = doc.getXmlFragment('content').toArray().find((value) => value instanceof Y.XmlElement && value.nodeName === 'paragraph') as Y.XmlElement | undefined;
  assert.ok(paragraph, `Expected a Tiptap paragraph, got ${xml(doc)}`);
  const value = paragraph.toArray().find((node) => node instanceof Y.XmlText);
  assert.ok(value instanceof Y.XmlText, 'Expected a Y.XmlText'); return value;
}
interface WireMessage { name: string; type: number; sub?: number; scope?: string; ack?: number; bytes: Uint8Array }
function inspectWire(bytes: Uint8Array): WireMessage {
  const decoder = decoding.createDecoder(bytes); const name = decoding.readVarString(decoder); const type = decoding.readVarUint(decoder);
  const result: WireMessage = { name, type, bytes };
  if (type === 2) { result.sub = decoding.readVarUint(decoder); result.scope = decoding.readVarString(decoder); }
  if (type === 8) result.ack = decoding.readVarInt(decoder);
  return result;
}
function frame(noteId: string, type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder(); encoding.writeVarString(encoder, noteId); encoding.writeVarUint(encoder, type); write(encoder); return encoding.toUint8Array(encoder);
}
function syncFrame(noteId: string, update: Uint8Array, subtype = 2) { return frame(noteId, 0, (encoder) => { encoding.writeVarUint(encoder, subtype); encoding.writeVarUint8Array(encoder, update); }); }
async function rawSocket(account: Account, origin: string | null = account.requestOrigin, cookie = account.cookie) {
  const headers: Record<string, string> = { Cookie: cookie }; if (origin !== null) headers.Origin = origin;
  const socket = new WebSocket(account.origin.replace(/^http/, 'ws') + '/api/collaboration', { headers });
  const messages: WireMessage[] = []; let closed = false;
  let closeCode: number | undefined; let closeReason = '';
  socket.on('close', (code, reason) => { closed = true; closeCode = code; closeReason = reason.toString(); }); socket.on('error', () => { /* Open promise reports handshake errors. */ });
  socket.on('message', (data) => { try { messages.push(inspectWire(new Uint8Array(data as Buffer))); } catch { /* Non-protocol replies never count as authorization or ACK. */ } });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return {
    socket, messages, get closed() { return closed; }, get closeCode() { return closeCode; }, get closeReason() { return closeReason; },
    async authenticate(noteId: string, csrf = account.csrf) {
      const before = messages.length;
      socket.send(frame(noteId, 2, (encoder) => { encoding.writeVarUint(encoder, 0); encoding.writeVarString(encoder, csrf); encoding.writeVarString(encoder, '4.7.1'); }));
      await until(() => messages.slice(before).some((message) => message.name === noteId && message.type === 2) || closed, 'No authentication decision received');
      return messages.slice(before).find((message) => message.name === noteId && message.type === 2);
    },
    close() { socket.terminate(); },
  };
}
async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'luckynote-crdt-test-'));
  const app = createApp({ dataDir: directory, env: { NODE_ENV: 'test', SESSION_SECRET: secret, ...overrides }, integrationHandler: async () => false });
  await listen(app.server); const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const peers: Peer[] = []; const wires: Awaited<ReturnType<typeof rawSocket>>[] = [];
  const result = {
    app, directory, origin, alice: new Account(origin, overrides.APP_ORIGIN || origin), bob: new Account(origin, overrides.APP_ORIGIN || origin), carol: new Account(origin, overrides.APP_ORIGIN || origin),
    peer(account: Account, noteId: string) { const item = peer(account, noteId); peers.push(item); return item; },
    async wire(account: Account, noteId?: string) { const item = await rawSocket(account); wires.push(item); if (noteId) assert.equal((await item.authenticate(noteId))?.sub, 2); return item; },
    async cleanup() { for (const item of peers) item.destroy(); for (const wire of wires) wire.close(); await app.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
  return result;
}
function persisted(app: ReturnType<typeof createApp>, noteId: string) {
  const doc = new Y.Doc();
  const snapshot = app.db.prepare('SELECT state FROM crdt_snapshots WHERE note_id=?').get(noteId) as { state: Uint8Array } | undefined;
  if (snapshot) Y.applyUpdate(doc, snapshot.state);
  const updates = app.db.prepare('SELECT payload FROM crdt_updates WHERE note_id=? ORDER BY seq').all(noteId) as { payload: Uint8Array }[];
  for (const update of updates) Y.applyUpdate(doc, update.payload);
  const result = xml(doc); doc.destroy(); return result;
}
function mutationFrom(base: Y.Doc, value: string) {
  const clone = new Y.Doc(); Y.applyUpdate(clone, Y.encodeStateAsUpdate(base));
  const vector = Y.encodeStateVector(clone); text(clone).insert(0, value); const update = Y.encodeStateAsUpdate(clone, vector); clone.destroy(); return update;
}

test('CRDT: authenticated frame floods are bounded before provider queueing and isolated by session', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('queue-attacker'); await f.bob.register('queue-editor');
    const group = await f.alice.group(); await f.alice.addMember(group, 'queue-editor', 'editor'); const noteId = await f.alice.note(group);
    const editor = f.peer(f.bob, noteId); await synced(editor);
    const wire = await f.wire(f.alice, noteId);
    const noChange = syncFrame(noteId, Y.encodeStateAsUpdate(new Y.Doc()));
    // A single TCP batch creates pending async protocol work; individual frames are small and valid.
    for (let index = 0; index < 1000; index++) wire.socket.send(noChange);
    await until(() => wire.closed, 'Authenticated flood did not close the socket');
    assert.equal(wire.closeCode, 1008); assert.match(wire.closeReason, /traffic limit/);
    text(editor).insert(0, 'OTHER_SESSION_OK');
    await until(() => persisted(f.app, noteId).includes('OTHER_SESSION_OK'), 'Another session was locked out by the flood');
    assert.equal(editor.closed, false);
    assert.ok(!persisted(f.app, noteId).includes('attacker'));
  } finally { await f.cleanup(); }
});

test('CRDT: production rejects an unverified legacy member directly at websocket authentication', async () => {
  const f = await fixture({ NODE_ENV: 'production', APP_ORIGIN: 'https://notes.example.test', AUTH_MODE: 'local', ALLOW_LOCAL_AUTH: 'true' });
  try {
    await f.alice.register('verified-owner'); await f.bob.register('claimed-email');
    f.app.db.prepare('UPDATE users SET google_sub=? WHERE id=?').run('verified-owner-test-sub', f.alice.id);
    const group = await f.alice.group(); const noteId = await f.alice.note(group);
    f.app.db.prepare('INSERT INTO members VALUES(?,?,?)').run(group, f.bob.id, 'editor');
    const owner = f.peer(f.alice, noteId); await synced(owner);
    const attacker = await f.wire(f.bob);
    assert.equal((await attacker.authenticate(noteId))?.sub, 1);
    const payload = mutationFrom(owner.doc, 'UNVERIFIED_ACCOUNT_WRITE');
    attacker.socket.send(syncFrame(noteId, payload)); await delay(100);
    assert.ok(!xml(owner).includes('UNVERIFIED_ACCOUNT_WRITE')); assert.ok(!persisted(f.app, noteId).includes('UNVERIFIED_ACCOUNT_WRITE'));
    assert.equal((await f.bob.api(`/api/notes/${noteId}`)).status, 404);
  } finally { await f.cleanup(); }
});

test('CRDT: two real providers merge concurrent edits, offline inserts/deletes and replay after reconnect', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('crdt-alice'); await f.bob.register('crdt-bob'); const group = await f.alice.group(); await f.alice.addMember(group, 'crdt-bob', 'editor'); const noteId = await f.alice.note(group);
    const descriptor = await f.alice.api(`/api/notes/${noteId}/collaboration`); assert.equal(descriptor.status, 200); assert.equal(descriptor.data.documentName, noteId); assert.equal(descriptor.data.wsPath, '/api/collaboration'); assert.equal(descriptor.data.readOnly, false);
    const a = f.peer(f.alice, noteId); const b = f.peer(f.bob, noteId); await Promise.all([synced(a), synced(b)]);
    assert.match(xml(a), /ABCD/); assert.equal(xml(a), xml(b));
    text(a).insert(0, 'alice-'); text(b).insert(text(b).length, '-bob');
    await until(() => xml(a) === xml(b) && xml(a).includes('alice-') && xml(a).includes('-bob') && !a.provider.hasUnsyncedChanges && !b.provider.hasUnsyncedChanges, 'Concurrent edits failed to converge');
    a.transport.disconnect(); b.transport.disconnect(); await until(() => a.transport.webSocket === null || a.transport.webSocket.readyState === WebSocket.CLOSED, 'A did not disconnect'); await until(() => b.transport.webSocket === null || b.transport.webSocket.readyState === WebSocket.CLOSED, 'B did not disconnect');
    text(a).delete(text(a).toString().indexOf('C'), 1); text(a).insert(0, 'offline-a|');
    text(b).delete(text(b).toString().indexOf('D'), 1); text(b).insert(text(b).length, '|offline-b');
    assert.notEqual(xml(a), xml(b));
    await Promise.all([a.transport.connect(), b.transport.connect()]);
    try { await until(() => xml(a) === xml(b) && xml(a).includes('offline-a|') && xml(a).includes('|offline-b') && !a.provider.hasUnsyncedChanges && !b.provider.hasUnsyncedChanges, 'Offline updates failed to merge'); }
    catch (error) { throw new Error(`${String(error)}: ${JSON.stringify({ a: xml(a), b: xml(b), aUnsynced: a.provider.unsyncedChanges, bUnsynced: b.provider.unsyncedChanges, aAuthenticated: a.provider.isAuthenticated, bAuthenticated: b.provider.isAuthenticated, errors: [...a.errors, ...b.errors] })}`, { cause: error }); }
    assert.ok(!xml(a).includes('C') && !xml(a).includes('D')); assert.equal(xml(a).split('offline-a|').length, 2); assert.equal(xml(a).split('|offline-b').length, 2);
    assert.equal(persisted(f.app, noteId), xml(a));
    const fresh = f.peer(f.alice, noteId); await synced(fresh); assert.equal(xml(fresh), xml(a));
  } finally { await f.cleanup(); }
});

test('CRDT: viewer forged SyncStep2 and Update frames cannot mutate live or stored document', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('owner'); await f.bob.register('viewer'); const group = await f.alice.group(); await f.alice.addMember(group, 'viewer', 'viewer'); const noteId = await f.alice.note(group);
    const owner = f.peer(f.alice, noteId); const viewer = f.peer(f.bob, noteId); await Promise.all([synced(owner), synced(viewer)]);
    assert.equal(viewer.provider.authorizedScope, 'readonly'); assert.equal((await f.bob.api(`/api/notes/${noteId}/collaboration`)).data.readOnly, true);
    const before = xml(owner);
    for (const type of [1, 2]) {
      const attack = await f.wire(f.bob, noteId); const initial = attack.messages.length;
      attack.socket.send(syncFrame(noteId, mutationFrom(owner.doc, `forged-${type}`), type));
      await until(() => attack.closed || attack.messages.slice(initial).some((m) => m.type === 7 || (m.type === 8 && m.ack === 0)), 'Viewer update was not rejected');
      assert.equal(xml(owner), before); assert.equal(persisted(f.app, noteId), before);
    }
  } finally { await f.cleanup(); }
});

test('CRDT: cookie, exact Origin, CSRF and per-document ACL guard every connection', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('auth-alice'); await f.bob.register('auth-bob'); const privateId = await f.alice.privateWorkspace(); const noteId = await f.alice.note(privateId);
    assert.equal((await f.bob.api(`/api/notes/${noteId}/collaboration`)).status, 404);
    await assert.rejects(rawSocket(f.alice, 'https://attacker.example'), /Unexpected server response|closed|ECONNRESET/i);
    await assert.rejects(rawSocket(f.alice, null), /Unexpected server response|closed|ECONNRESET/i);
    await assert.rejects(rawSocket(f.alice, f.origin, ''), /Unexpected server response|closed|ECONNRESET/i);
    const wrongCsrf = await f.wire(f.alice); const denied = await wrongCsrf.authenticate(noteId, 'wrong-csrf'); assert.ok(denied?.sub === 1 || wrongCsrf.closed); assert.equal(wrongCsrf.messages.filter((m) => m.type === 0).length, 0);
    const stranger = await f.wire(f.bob); const notAllowed = await stranger.authenticate(noteId); assert.ok(notAllowed?.sub === 1 || stranger.closed); assert.equal(stranger.messages.filter((m) => m.type === 0).length, 0);
    const legitimate = f.peer(f.alice, noteId); await synced(legitimate); assert.match(xml(legitimate), /ABCD/);
  } finally { await f.cleanup(); }
});

test('CRDT: revocation, logout and expiry close idle readers before subsequent broadcasts', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('revoke-owner'); await f.bob.register('revoke-editor'); const group = await f.alice.group(); await f.alice.addMember(group, 'revoke-editor', 'editor'); const noteId = await f.alice.note(group);
    const owner = f.peer(f.alice, noteId); const removed = f.peer(f.bob, noteId); await Promise.all([synced(owner), synced(removed)]);
    assert.equal((await f.alice.api(`/api/workspaces/${group}/members/${f.bob.id}`, 'DELETE')).status, 200); await until(() => removed.closed, 'Revoked idle connection remained open');
    const old = xml(removed); text(owner).insert(0, 'after-removal-'); await until(() => !owner.provider.hasUnsyncedChanges, 'Owner write was not ACKed'); assert.equal(xml(removed), old);
    removed.transport.disconnect();
    await f.alice.addMember(group, 'revoke-editor', 'editor'); const logout = f.peer(f.bob, noteId); await synced(logout); assert.equal((await f.bob.api('/api/auth/logout', 'POST')).status, 200); await until(() => logout.closed, 'Logout did not close socket'); logout.transport.disconnect();
    const freshAccount = new Account(f.origin); await freshAccount.register('expire-editor'); await f.alice.addMember(group, 'expire-editor', 'editor'); const expiring = f.peer(freshAccount, noteId); await synced(expiring);
    f.app.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(Date.now() - 1, freshAccount.id);
    await until(() => expiring.closed, 'Expired idle session remained connected', 4000); expiring.transport.disconnect();
    assert.equal((await freshAccount.api(`/api/notes/${noteId}/collaboration`)).status, 401);
  } finally { await f.cleanup(); }
});

test('CRDT: SQLite journal failure rejects a write before ACK or broadcast', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('failure-owner'); await f.bob.register('failure-editor'); const group = await f.alice.group(); await f.alice.addMember(group, 'failure-editor', 'editor'); const noteId = await f.alice.note(group);
    const observer = f.peer(f.alice, noteId); const writer = await f.wire(f.bob, noteId); await synced(observer); const before = xml(observer);
    f.app.db.exec("CREATE TRIGGER crdt_test_fail BEFORE INSERT ON crdt_updates BEGIN SELECT RAISE(ABORT, 'test injected storage failure'); END;");
    const start = writer.messages.length; writer.socket.send(syncFrame(noteId, mutationFrom(observer.doc, 'must-not-appear')));
    await until(() => writer.closed || writer.messages.slice(start).some((m) => m.type === 7), 'Storage failure did not reject writer');
    assert.ok(!writer.messages.slice(start).some((m) => m.type === 8 && m.ack === 1), 'Failed write received successful ACK');
    assert.equal(xml(observer), before); assert.equal(persisted(f.app, noteId), before);
    f.app.db.exec('DROP TRIGGER crdt_test_fail');
    const healthy = f.peer(f.bob, noteId); await synced(healthy); assert.equal(xml(healthy), before);
  } finally { await f.cleanup(); }
});

test('CRDT: duplicate valid update is idempotent and malformed/oversized messages do not harm the service', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('limits-owner'); const noteId = await f.alice.note(await f.alice.privateWorkspace()); const observer = f.peer(f.alice, noteId); await synced(observer);
    const writer = await f.wire(f.alice, noteId); const update = mutationFrom(observer.doc, 'once-only-'); const hash = createHash('sha256').update(update).digest('hex'); const packet = syncFrame(noteId, update);
    writer.socket.send(packet); writer.socket.send(packet);
    await until(() => xml(observer).includes('once-only-') && writer.messages.filter((m) => m.type === 8 && m.ack === 1).length >= 2, 'Repeated update not acknowledged');
    assert.equal(xml(observer).split('once-only-').length, 2); assert.equal(persisted(f.app, noteId), xml(observer));
    const count = f.app.db.prepare('SELECT COUNT(*) AS count FROM crdt_updates WHERE note_id=? AND hash=?').get(noteId, hash) as { count: number }; assert.ok(count.count <= 1, 'Identical binary update was journaled more than once');
    const corrupt = await f.wire(f.alice, noteId); const initial = corrupt.messages.length; corrupt.socket.send(syncFrame(noteId, Uint8Array.of(255, 255, 255)));
    await until(() => corrupt.closed || corrupt.messages.slice(initial).some((m) => m.type === 7), 'Malformed update was not rejected');
    const large = await f.wire(f.alice, noteId); large.socket.send(Buffer.alloc(NOTE_LIMITS.stateBytes + 4097)); await until(() => large.closed, 'Oversized message did not close socket');
    assert.equal((await f.alice.api('/api/health')).status, 200); assert.equal(persisted(f.app, noteId), xml(observer));
  } finally { await f.cleanup(); }
});

test('CRDT: awareness is disabled and cannot relay a forged user identity', { timeout: 20000 }, async () => {
  const f = await fixture();
  const awarenessDoc = new Y.Doc(); const awareness = new Awareness(awarenessDoc);
  try {
    await f.alice.register('awareness-owner'); const noteId = await f.alice.note(await f.alice.privateWorkspace());
    const observer = await f.wire(f.alice, noteId); const writer = await f.wire(f.alice, noteId); const previous = observer.messages.length;
    awareness.setLocalState({ user: { id: 'another-person', name: 'Forged admin' } });
    const update = encodeAwarenessUpdate(awareness, [awarenessDoc.clientID]); const initial = writer.messages.length;
    writer.socket.send(frame(noteId, 1, (encoder) => encoding.writeVarUint8Array(encoder, update)));
    await until(() => writer.closed || writer.messages.slice(initial).some((m) => m.type === 7), 'Disabled awareness was accepted');
    assert.ok(!observer.messages.slice(previous).some((m) => m.type === 1), 'Forged awareness was broadcast');
  } finally { awareness.destroy(); awarenessDoc.destroy(); await f.cleanup(); }
});

test('CRDT: unresolved dependency payloads cannot hide invalid state or poison the journal', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('dependency-owner'); const noteId = await f.alice.note(await f.alice.privateWorkspace());
    const observer = f.peer(f.alice, noteId); await synced(observer); const before = persisted(f.app, noteId);
    for (const mode of ['struct', 'delete']) {
      const clone = new Y.Doc(); Y.applyUpdate(clone, Y.encodeStateAsUpdate(observer.doc));
      if (mode === 'struct') clone.getMap('metadata').set('unsupported', 'first');
      else text(clone).insert(0, 'missing-parent');
      const vectorAfterOmittedUpdate = Y.encodeStateVector(clone);
      if (mode === 'struct') clone.getMap('metadata').set('unsupported', 'hidden');
      else text(clone).delete(0, 'missing-parent'.length);
      const incomplete = Y.encodeStateAsUpdate(clone, vectorAfterOmittedUpdate);
      const scratch = new Y.Doc(); Y.applyUpdate(scratch, Y.encodeStateAsUpdate(observer.doc)); Y.applyUpdate(scratch, incomplete);
      assert.ok(scratch.store.pendingStructs || scratch.store.pendingDs, 'Fixture must really contain unresolved Yjs dependencies');
      scratch.destroy(); clone.destroy();
      const wire = await f.wire(f.alice, noteId); const start = wire.messages.length;
      wire.socket.send(syncFrame(noteId, incomplete));
      await until(() => wire.closed || wire.messages.slice(start).some(message => message.type === 7), 'Incomplete update was not rejected');
      assert.ok(!wire.messages.slice(start).some(message => message.type === 8 && message.ack === 1));
      assert.equal(persisted(f.app, noteId), before); assert.equal(xml(observer), before);
      const hash = createHash('sha256').update(incomplete).digest('hex');
      assert.equal((f.app.db.prepare('SELECT COUNT(*) AS count FROM crdt_updates WHERE note_id=? AND hash=?').get(noteId, hash) as { count: number }).count, 0);
    }
    const healthy = f.peer(f.alice, noteId); await synced(healthy); text(healthy).insert(0, 'still-healthy-');
    await until(() => xml(observer).includes('still-healthy-') && !healthy.provider.hasUnsyncedChanges, 'Rejected pending data poisoned later legitimate updates');
  } finally { await f.cleanup(); }
});

test('CRDT: migration preserves drawings, metadata edits do not conflict with body edits, and JSON round-trip retains content', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('migration-owner'); const workspaceId = await f.alice.privateWorkspace();
    const sketch = Buffer.from(JSON.stringify([{ points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.9 }], color: '#ff0000', width: 3 }])).toString('base64');
    const legacy = `# Trip\n\n- [x] done\n- [ ] next\n\nSome **bold** words.\n\n<!--luckynote-sketch:${sketch}-->`;
    const noteId = await f.alice.note(workspaceId, legacy);
    const descriptor = await f.alice.api(`/api/notes/${noteId}/collaboration`); assert.equal(descriptor.status, 200);
    const stored = f.app.db.prepare('SELECT legacy_content,state FROM crdt_snapshots WHERE note_id=?').get(noteId) as { legacy_content: string; state: Uint8Array };
    assert.equal(stored.legacy_content, legacy);
    assert.equal((await f.alice.api(`/api/notes/${noteId}/collaboration`)).status, 200);
    const again = f.app.db.prepare('SELECT state FROM crdt_snapshots WHERE note_id=?').get(noteId) as { state: Uint8Array }; assert.deepEqual(again.state, stored.state, 'Repeated migration changed document identity');
    const editor = f.peer(f.alice, noteId); await synced(editor); assert.equal(editor.doc.getMap('metadata').get('sketch'), sketch);
    const originalMetadataVersion = descriptor.data.metadataVersion as number;
    text(editor).insert(0, 'live-edit-'); await until(() => !editor.provider.hasUnsyncedChanges, 'Body edit was not ACKed');
    const bodySaved = await f.alice.api(`/api/notes/${noteId}`); assert.equal(bodySaved.data.note.metadataVersion, originalMetadataVersion); assert.ok(bodySaved.data.note.contentRevision >= 2);
    const metadata = await f.alice.api(`/api/notes/${noteId}`, 'PATCH', { title: 'Updated title', tags: ['shared'], metadataVersion: originalMetadataVersion }); assert.equal(metadata.status, 200); assert.equal(metadata.data.note.metadataVersion, originalMetadataVersion + 1);
    assert.equal((await f.alice.api(`/api/notes/${noteId}`, 'PATCH', { title: 'Stale title', metadataVersion: originalMetadataVersion })).status, 409);
    const overwrite = await f.alice.api(`/api/notes/${noteId}`, 'PATCH', { content: 'must not replace Yjs state', metadataVersion: originalMetadataVersion + 1, version: metadata.data.note.version }); assert.equal(overwrite.status, 409); assert.equal(overwrite.data.code, 'CRDT_CONTENT_OWNED');
    const archive = (await f.alice.api(`/api/workspaces/${workspaceId}/export`)).data; assert.ok((archive.notes as Json[])[0]!.content.includes('live-edit-'));
    const destination = await f.alice.group(); const imported = await f.alice.api(`/api/workspaces/${destination}/import`, 'POST', { archive, clientMutationId: 'migration-round-trip' }); assert.equal(imported.status, 201);
    const restoredId = ((await f.alice.api(`/api/workspaces/${destination}/notes`)).data.notes as Json[])[0]!.id as string;
    const restored = f.peer(f.alice, restoredId); await synced(restored); assert.equal(xml(restored), xml(editor)); assert.equal(restored.doc.getMap('metadata').get('sketch'), sketch);
    assert.equal((await f.alice.api(`/api/notes/${restoredId}`)).data.note.title, 'Updated title');
  } finally { await f.cleanup(); }
});

test('CRDT: downgrading a live editor closes the old writer and reconnects as read-only', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('downgrade-owner'); await f.bob.register('downgrade-editor'); const workspaceId = await f.alice.group(); await f.alice.addMember(workspaceId, 'downgrade-editor', 'editor'); const noteId = await f.alice.note(workspaceId);
    const editor = f.peer(f.bob, noteId); await synced(editor); assert.equal(editor.provider.authorizedScope, 'read-write');
    await f.alice.addMember(workspaceId, 'downgrade-editor', 'viewer'); await until(() => editor.closed, 'Role downgrade did not close writer'); editor.transport.disconnect();
    const viewer = f.peer(f.bob, noteId); await synced(viewer); assert.equal(viewer.provider.authorizedScope, 'readonly');
    const latest = (await f.bob.api(`/api/notes/${noteId}`)).data.note;
    assert.equal((await f.bob.api(`/api/notes/${noteId}`, 'PATCH', { title: 'not allowed', metadataVersion: latest.metadataVersion })).status, 403);
  } finally { await f.cleanup(); }
});

test('CRDT: deleting a note closes collaborators and delayed persistence cannot resurrect it', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.alice.register('delete-owner'); const noteId = await f.alice.note(await f.alice.privateWorkspace()); const editor = f.peer(f.alice, noteId); await synced(editor);
    text(editor).insert(0, 'pending-store-'); await until(() => !editor.provider.hasUnsyncedChanges, 'Body edit did not persist');
    const current = (await f.alice.api(`/api/notes/${noteId}`)).data.note; assert.equal((await f.alice.api(`/api/notes/${noteId}`, 'DELETE', { version: current.version })).status, 200);
    await until(() => editor.closed, 'Deleted note connection did not close'); editor.transport.disconnect();
    // Wait past the configured one-second compaction debounce to exercise its deletion guard.
    await delay(1200);
    assert.equal(f.app.db.prepare('SELECT id FROM notes WHERE id=?').get(noteId), undefined);
    assert.equal(f.app.db.prepare('SELECT note_id FROM crdt_snapshots WHERE note_id=?').get(noteId), undefined);
    assert.equal(f.app.db.prepare('SELECT note_id FROM crdt_updates WHERE note_id=?').get(noteId), undefined);
    assert.equal((await f.alice.api(`/api/notes/${noteId}/collaboration`)).status, 404);
    const stale = await f.wire(f.alice); const auth = await stale.authenticate(noteId); assert.ok(auth?.sub === 1 || stale.closed);
  } finally { await f.cleanup(); }
});

async function startChild(directory: string, port: number) {
  const child = fork(fileURLToPath(new URL('./fixtures/collab-child.js', import.meta.url)), [directory, String(port)], { env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: secret, APP_ORIGIN: `http://127.0.0.1:${port}` }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let output = ''; child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); }); child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Child startup timed out: ${output}`)); }, 10000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Child exited before startup (${code}): ${output}`)); });
    child.once('message', (message) => { if ((message as Json).kind === 'ready') { clearTimeout(timer); resolve(); } else { clearTimeout(timer); reject(new Error('Unexpected child startup message')); } });
  });
  return child;
}
async function killChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
}
test('CRDT: an ACKed edit survives abrupt process termination and restart from SQLite', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'luckynote-crdt-crash-')); const port = randomInt(32000, 48000);
  let child: ChildProcess | undefined; let original: Peer | undefined; let restored: Peer | undefined;
  try {
    child = await startChild(directory, port); const owner = await new Account(`http://127.0.0.1:${port}`).register('crash-owner'); const noteId = await owner.note(await owner.privateWorkspace());
    assert.equal((await owner.api(`/api/notes/${noteId}/collaboration`)).status, 200);
    original = peer(owner, noteId); await synced(original); text(original).insert(0, 'durable-before-crash-');
    await until(() => !original!.provider.hasUnsyncedChanges, 'Durable write did not receive ACK'); const expected = xml(original);
    await killChild(child); child = undefined; original.destroy(); original = undefined;
    child = await startChild(directory, port); restored = peer(owner, noteId); await synced(restored);
    assert.equal(xml(restored), expected); const recoveredNote = await owner.api(`/api/notes/${noteId}`); assert.equal(recoveredNote.status, 200); assert.ok(recoveredNote.data.note.content.includes('durable-before-crash-'));
  } finally {
    original?.destroy(); restored?.destroy(); if (child) await killChild(child);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
