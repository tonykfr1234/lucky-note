import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage as HttpRequest, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { Hocuspocus, IncomingMessage, type Connection } from '@hocuspocus/server';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import * as Y from 'yjs';
import { SCHEMA_VERSION, NOTE_LIMITS } from '../shared/editor-schema.js';
import { markdownToYDoc, projectNoteDoc, validateNoteDoc } from './note-format.js';
import { HttpError, type Role } from './types.js';

export interface CollaborationSession { sessionId: string; userId: string; csrf: string; expiresAt: number }
interface Context { sessionId: string; userId: string; workspaceId: string; noteId: string; role: Role }
interface Access { workspace_id: string; user_id: string; role: Role; expires_at: number; csrf: string; workspace_type: string; google_sub: string | null }
interface Snapshot { state: Uint8Array; schema_version: number; last_seq: number }
interface CollaborationOptions {
  server: Server; db: DatabaseSync; env: NodeJS.ProcessEnv;
  authenticateCookie: (cookie: string | undefined) => CollaborationSession | null;
  broadcast: (workspaceId: string, event: Record<string, unknown>) => void;
}
const DOCUMENT_LIMIT = NOTE_LIMITS.stateBytes;
const MESSAGE_LIMIT = DOCUMENT_LIMIT + 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = (reason = 'Permission denied') => ({ code: 4403, reason });
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Attach the mature Hocuspocus/Yjs wire protocol to our existing same-origin HTTP service. */
export function attachCollaboration({ server, db, env, authenticateCookie, broadcast }: CollaborationOptions) {
  db.exec(`CREATE TABLE IF NOT EXISTS crdt_snapshots (
    note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    state BLOB NOT NULL,schema_version INTEGER NOT NULL,last_seq INTEGER NOT NULL DEFAULT 0,
    legacy_content TEXT NOT NULL,stored_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crdt_updates (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,payload BLOB NOT NULL,created_at TEXT NOT NULL,UNIQUE(note_id,hash));
    CREATE INDEX IF NOT EXISTS crdt_updates_note ON crdt_updates(note_id,seq);`);
  const columns = new Set((db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]).map(row => row.name));
  if (!columns.has('metadata_version')) db.exec('ALTER TABLE notes ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1');
  if (!columns.has('content_revision')) db.exec('ALTER TABLE notes ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('content_mode')) db.exec("ALTER TABLE notes ADD COLUMN content_mode TEXT NOT NULL DEFAULT 'plain'");
  db.exec('PRAGMA user_version=2');
  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const sockets = new Map<WebSocket, { sessionId: string; expiresAt: number; handleClose: () => void }>();
  const connections = new Set<Connection<Context>>();
  const held = new Map<Connection<Context>, { release: () => void; workspaceId: string; changed: boolean }>();
  const tails = new Map<string, Promise<void>>();
  const ingress = new Map<string, { windowStart: number; frames: number; pending: number; bytes: number }>();

  // This lock covers the gap between the awaited beforeSync hook and protocol apply.
  async function acquire(noteId: string): Promise<() => void> {
    const previous = tails.get(noteId) || Promise.resolve();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const tail = previous.then(() => gate);
    tails.set(noteId, tail);
    await previous;
    let released = false;
    return () => { if (released) return; released = true; finish(); if (tails.get(noteId) === tail) tails.delete(noteId); };
  }
  function access(sessionId: string, noteId: string): Access {
    if (!UUID.test(noteId)) throw denied();
    const row = db.prepare(`SELECT n.workspace_id,s.user_id,m.role,s.expires_at,s.csrf,w.type AS workspace_type,u.google_sub FROM notes n
      JOIN workspaces w ON w.id=n.workspace_id JOIN members m ON m.workspace_id=n.workspace_id
      JOIN sessions s ON s.user_id=m.user_id JOIN users u ON u.id=s.user_id
      WHERE n.id=? AND s.id=? AND s.expires_at>?`).get(noteId, sessionId, Date.now()) as unknown as Access | undefined;
    if (!row) throw denied();
    if (env.NODE_ENV === 'production' && row.workspace_type === 'group' && row.role !== 'owner' && !row.google_sub) throw denied('Verified identity required');
    return row;
  }
  function ensureMigration(noteId: string): Snapshot {
    const existing = db.prepare('SELECT state,schema_version,last_seq FROM crdt_snapshots WHERE note_id=?').get(noteId) as unknown as Snapshot | undefined;
    if (existing) {
      if (existing.schema_version !== SCHEMA_VERSION) throw new HttpError(409, '筆記協作格式版本不相容，請升級應用程式', 'CRDT_SCHEMA_VERSION');
      return existing;
    }
    const note = db.prepare('SELECT content,workspace_id FROM notes WHERE id=?').get(noteId) as { content: string; workspace_id: string } | undefined;
    if (!note) throw new HttpError(404, '找不到筆記', 'NOT_FOUND');
    let document: Y.Doc;
    try { document = markdownToYDoc(note.content); }
    catch { throw new HttpError(422, '原始筆記格式無法安全遷移；原文已保留，可先匯出檢查', 'CRDT_MIGRATION'); }
    try {
      validateNoteDoc(document);
      const state = Y.encodeStateAsUpdate(document);
      if (state.byteLength > DOCUMENT_LIMIT) throw new HttpError(413, '協作筆記超過大小限制', 'CRDT_TOO_LARGE');
      const projection = projectNoteDoc(document);
      transaction(() => {
        db.prepare('INSERT INTO crdt_snapshots(note_id,state,schema_version,last_seq,legacy_content,stored_at) VALUES(?,?,?,0,?,?)').run(noteId, state, SCHEMA_VERSION, note.content, new Date().toISOString());
        db.prepare("UPDATE notes SET content=?,content_mode='yjs-v1',content_revision=1,version=version+1 WHERE id=?").run(projection, noteId);
      });
      broadcast(note.workspace_id, { kind: 'notes', noteId, collaborative: true });
      return { state, schema_version: SCHEMA_VERSION, last_seq: 0 };
    } finally { document.destroy(); }
  }
  function restore(noteId: string, document: Y.Doc): void {
    const snapshot = ensureMigration(noteId);
    Y.applyUpdate(document, snapshot.state);
    const updates = db.prepare('SELECT payload FROM crdt_updates WHERE note_id=? AND seq>? ORDER BY seq').all(noteId, snapshot.last_seq) as unknown as { payload: Uint8Array }[];
    for (const update of updates) Y.applyUpdate(document, update.payload);
    if (document.store.pendingStructs || document.store.pendingDs) throw new Error('Incomplete persisted CRDT dependencies');
    validateNoteDoc(document);
    const projection = projectNoteDoc(document);
    db.prepare('UPDATE notes SET content=? WHERE id=? AND content<>?').run(projection, noteId, projection);
  }
  async function compact(noteId: string, document: Y.Doc): Promise<void> {
    const release = await acquire(noteId);
    try {
      // A deleted document must never be recreated by a delayed provider store hook.
      if (!db.prepare('SELECT id FROM notes WHERE id=?').get(noteId)) return;
      const state = Y.encodeStateAsUpdate(document);
      validateNoteDoc(document);
      transaction(() => {
        const maximum = db.prepare('SELECT COALESCE(MAX(seq),0) AS value FROM crdt_updates WHERE note_id=?').get(noteId) as { value: number };
        db.prepare('UPDATE crdt_snapshots SET state=?,last_seq=MAX(last_seq,?),stored_at=? WHERE note_id=?').run(state, maximum.value, new Date().toISOString(), noteId);
        db.prepare('DELETE FROM crdt_updates WHERE note_id=? AND seq<=?').run(noteId, maximum.value);
      });
    } finally { release(); }
  }
  const hocuspocus = new Hocuspocus<Context>({
    quiet: true, timeout: 30000, debounce: 1000, maxDebounce: 5000,
    maxUnauthenticatedQueueSize: 128 * 1024, maxUnauthenticatedQueueMessages: 32, maxPendingDocuments: 4,
    flushDelay: false, unloadImmediately: true,
    async onAuthenticate({ documentName, token, requestHeaders, connectionConfig }) {
      if (closing) throw denied('Server is shutting down');
      const session = authenticateCookie(requestHeaders.get('cookie') || undefined);
      if (!session || token.length > 128 || !same(token, session.csrf)) throw denied('Invalid session or CSRF token');
      const allowed = access(session.sessionId, documentName);
      connectionConfig.readOnly = allowed.role === 'viewer';
      return { sessionId: session.sessionId, userId: session.userId, noteId: documentName, workspaceId: allowed.workspace_id, role: allowed.role };
    },
    async onTokenSync({ context, token, connection, documentName }) {
      const allowed = access(context.sessionId, documentName);
      if (token.length > 128 || !same(token, allowed.csrf)) throw denied('Invalid CSRF token');
      connection.readOnly = allowed.role === 'viewer';
    },
    async connected({ connection, context, documentName }) {
      if (closing) { connection.close(denied('Server is shutting down')); return; }
      const allowed = access(context.sessionId, documentName);
      if (allowed.role !== context.role) { connection.close(denied('Permissions changed')); return; }
      connections.add(connection);
      connection.onClose(() => { connections.delete(connection); });
    },
    async onLoadDocument({ documentName, document, context }) {
      if (closing) throw denied('Server is shutting down');
      access(context.sessionId, documentName);
      restore(documentName, document);
      return document;
    },
    async beforeHandleMessage({ connection, documentName, context, update }) {
      if (closing || !connection.document.hasConnection(connection)) throw denied('Connection closed');
      const allowed = access(context.sessionId, documentName);
      if (allowed.role !== context.role) throw denied('Permissions changed');
      connection.readOnly = allowed.role === 'viewer';
      if (update.byteLength > MESSAGE_LIMIT) throw { code: 1009, reason: 'Message too large' };
      // Presence and arbitrary stateless broadcasts are deliberately disabled in this release.
      const message = new IncomingMessage(update); message.readVarString();
      const kind = message.readVarUint();
      if (kind === 1 || kind === 5 || kind === 6) throw denied('Awareness and stateless messages are disabled');
    },
    async beforeHandleAwareness() { throw denied('Awareness is disabled'); },
    async beforeSync({ type, payload, document, documentName, connection, context }) {
      const initialAccess = access(context.sessionId, documentName);
      if (type === 0) return;
      if (type !== 1 && type !== 2) throw denied('Unsupported sync message');
      if (payload.byteLength > MESSAGE_LIMIT) throw { code: 1009, reason: 'Update too large' };
      // Never write viewer payloads to the journal, even though Hocuspocus also blocks apply.
      if (initialAccess.role === 'viewer') {
        if (type === 1 && Y.snapshotContainsUpdate(Y.snapshot(document), payload)) return;
        throw denied('Read-only document');
      }
      const release = await acquire(documentName);
      try {
        const allowed = access(context.sessionId, documentName);
        if (closing || allowed.role === 'viewer' || !document.hasConnection(connection)) throw denied();
        if (Y.snapshotContainsUpdate(Y.snapshot(document), payload)) { release(); return; }
        const scratch = new Y.Doc();
        let projection: string;
        try {
          Y.applyUpdate(scratch, Y.encodeStateAsUpdate(document));
          Y.applyUpdate(scratch, payload);
          // Hocuspocus state-vector synchronization supplies missing dependencies. Do not
          // journal opaque pending structs/delete sets that evade the live-schema validator.
          // A client with an incomplete incremental update must reconnect and send full missing state.
          if (scratch.store.pendingStructs || scratch.store.pendingDs) throw new Error('Incomplete update dependencies');
          validateNoteDoc(scratch);
          if (Y.encodeStateAsUpdate(scratch).byteLength > DOCUMENT_LIMIT) throw new Error('Document too large');
          projection = projectNoteDoc(scratch);
        } catch (error) {
          if (env.NODE_ENV === 'test') console.warn('[CRDT validation in isolated tests]', error instanceof Error ? error.message.slice(0, 200) : 'validation failed');
          throw { code: 4400, reason: 'Invalid or oversized collaborative document' };
        }
        finally { scratch.destroy(); }
        const hash = createHash('sha256').update(payload).digest('hex');
        // Synchronous SQLite commit happens BEFORE Hocuspocus applies or acknowledges the update.
        transaction(() => {
          db.prepare('INSERT OR IGNORE INTO crdt_updates(note_id,hash,payload,created_at) VALUES(?,?,?,?)').run(documentName, hash, payload, new Date().toISOString());
          db.prepare('UPDATE notes SET content=?,content_revision=content_revision+1,version=version+1,updated_at=? WHERE id=?').run(projection, new Date().toISOString(), documentName);
        });
        held.set(connection, { release, workspaceId: allowed.workspace_id, changed: true });
      } catch (error) { release(); throw error; }
    },
    async afterHandleMessage({ connection, documentName }) {
      const pending = held.get(connection);
      if (!pending) return;
      held.delete(connection);
      try { if (pending.changed) broadcast(pending.workspaceId, { kind: 'notes', noteId: documentName, collaborative: true }); }
      finally { pending.release(); }
    },
    async onStoreDocument({ documentName, document }) { await compact(documentName, document); },
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MESSAGE_LIMIT, perMessageDeflate: false });
  function rejectUpgrade(socket: Duplex, status: number): void {
    socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  function upgrade(request: HttpRequest, socket: Duplex, head: Buffer): void {
    try {
      const path = new URL(request.url || '/', 'http://localhost');
      const origin = request.headers.origin;
      const expectedOrigin = env.APP_ORIGIN || `http://${request.headers.host || ''}`;
      if (closing || path.pathname !== '/api/collaboration' || path.search || !origin || origin !== expectedOrigin || (!env.APP_ORIGIN && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(expectedOrigin))) { rejectUpgrade(socket, 403); return; }
      const session = authenticateCookie(request.headers.cookie);
      if (!session) { rejectUpgrade(socket, 401); return; }
      if ([...sockets.values()].filter(item => item.sessionId === session.sessionId).length >= 20) { rejectUpgrade(socket, 403); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const webRequest = new Request(`${expectedOrigin}/api/collaboration`, { headers });
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        const client = hocuspocus.handleConnection(websocket, webRequest);
        let closed = false;
        const deadline = setTimeout(() => { websocket.close(4401, 'Session expired'); }, Math.max(1, session.expiresAt - Date.now()));
        deadline.unref();
        const handleClose = () => { if (closed) return; closed = true; clearTimeout(deadline); client.handleClose(); sockets.delete(websocket); };
        sockets.set(websocket, { sessionId: session.sessionId, expiresAt: session.expiresAt, handleClose });
        websocket.on('message', (data: RawData, isBinary: boolean) => {
          if (closed || closing || websocket.readyState !== 1) return;
          if (!isBinary) { websocket.close(4400, 'Binary protocol required'); return; }
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
          const now = Date.now();
          let budget = ingress.get(session.sessionId);
          if (!budget) { budget = { windowStart: now, frames: 0, pending: 0, bytes: 0 }; ingress.set(session.sessionId, budget); }
          if (now - budget.windowStart >= 1000) { budget.windowStart = now; budget.frames = 0; }
          // Admission precedes Hocuspocus's messageQueue.push. Limits are shared across
          // this authenticated session's sockets; ordinary collaborators have separate budgets.
          if (++budget.frames > 200 || budget.pending >= 64 || budget.bytes + bytes.byteLength > MESSAGE_LIMIT) {
            websocket.close(1008, 'Collaboration traffic limit exceeded'); handleClose(); return;
          }
          budget.pending++; budget.bytes += bytes.byteLength;
          const admitted = budget;
          const releaseBudget = () => { admitted.pending--; admitted.bytes -= bytes.byteLength; };
          try {
            client.handleMessage(bytes);
            // handleMessage synchronously enqueues established connections. Retain admission
            // until their actual async hooks/protocol processing (including the document mutex)
            // drain. Pre-auth queues have Hocuspocus's independent 128 KiB / 32-frame bound.
            const pending = [...connections].filter(connection => connection.webSocket === websocket).map(connection => connection.waitForPendingMessages());
            void Promise.all(pending).then(releaseBudget, () => { releaseBudget(); websocket.close(4400, 'Invalid protocol message'); });
          } catch { releaseBudget(); websocket.close(4400, 'Invalid protocol message'); }
        });
        websocket.on('pong', () => client.touch());
        websocket.on('close', handleClose);
        websocket.on('error', () => { handleClose(); websocket.terminate(); });
      });
    } catch { rejectUpgrade(socket, 403); }
  }
  server.on('upgrade', upgrade);
  // Re-check idle readers too: an expired/revoked account must not keep receiving broadcasts.
  const sweeper = setInterval(() => {
    if (closing) return;
    for (const connection of connections) {
      try { const allowed = access(connection.context.sessionId, connection.document.name); if (allowed.role !== connection.context.role) connection.close(denied('Permissions changed')); }
      catch { connection.close(denied('Access revoked')); }
    }
    for (const [websocket, item] of sockets) {
      if (!db.prepare('SELECT id FROM sessions WHERE id=? AND expires_at>?').get(item.sessionId, Date.now())) websocket.close(4401, 'Session expired');
    }
    for (const [sessionId, budget] of ingress) if (budget.pending === 0 && Date.now() - budget.windowStart > 1000) ingress.delete(sessionId);
  }, 1000);
  sweeper.unref();
  const heartbeat = setInterval(() => { for (const websocket of sockets.keys()) if (websocket.readyState === 1) websocket.ping(); }, 15000);
  heartbeat.unref();

  function revalidateWorkspace(workspaceId: string): void {
    for (const connection of [...connections]) if (connection.context.workspaceId === workspaceId) {
      try { const allowed = access(connection.context.sessionId, connection.document.name); if (allowed.role !== connection.context.role) connection.close(denied('Permissions changed')); }
      catch { connection.close(denied('Access revoked')); }
    }
  }
  function revokeSession(sessionId: string): void {
    for (const connection of [...connections]) if (connection.context.sessionId === sessionId) connection.close(denied('Session ended'));
    for (const [websocket, item] of sockets) if (item.sessionId === sessionId) websocket.close(4401, 'Session ended');
  }
  function deleteNote(noteId: string): void { for (const connection of [...connections]) if (connection.document.name === noteId) connection.close(denied('Document deleted')); }
  function describe(noteId: string, userId: string) {
    const row = db.prepare('SELECT n.metadata_version,m.role FROM notes n JOIN members m ON m.workspace_id=n.workspace_id WHERE n.id=? AND m.user_id=?').get(noteId, userId) as { metadata_version: number; role: Role } | undefined;
    if (!row) throw new HttpError(404, '找不到筆記', 'NOT_FOUND');
    ensureMigration(noteId);
    const latest = db.prepare('SELECT version,content_revision FROM notes WHERE id=?').get(noteId) as { version: number; content_revision: number };
    return { documentName: noteId, wsPath: '/api/collaboration', schemaVersion: SCHEMA_VERSION, readOnly: row.role === 'viewer', metadataVersion: row.metadata_version, version: latest.version, contentRevision: latest.content_revision, awarenessEnabled: false };
  }
  async function shutdown(): Promise<void> {
    closing = true; server.off('upgrade', upgrade); clearInterval(sweeper); clearInterval(heartbeat);
    await Promise.all([...connections].map(connection => connection.waitForPendingMessages()));
    for (const [websocket, item] of [...sockets]) { item.handleClose(); websocket.terminate(); }
    for (const document of [...hocuspocus.documents.values()]) {
      await hocuspocus.debouncer.executeNow(`onStoreDocument-${document.name}`);
      await compact(document.name, document);
    }
    // onDisconnect may schedule stores in a microtask; drain each save mutex before closing SQLite.
    await Promise.resolve();
    for (const document of [...hocuspocus.documents.values()]) {
      await hocuspocus.debouncer.executeNow(`onStoreDocument-${document.name}`);
      await document.saveMutex.waitForUnlock();
      await hocuspocus.unloadDocument(document);
    }
    for (const document of hocuspocus.documents.values()) document.destroy();
    hocuspocus.documents.clear();
    await new Promise<void>(resolve => websocketServer.close(() => resolve()));
  }
  return { describe, revalidateWorkspace, revokeSession, deleteNote, close: () => { closePromise ??= shutdown(); return closePromise; } };
}
