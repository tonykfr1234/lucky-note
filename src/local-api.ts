import type { Attachment, Expense, Note, Notebook, User, Workspace } from './types';
import { templates } from './templates';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { COLLAB_FIELD, editorSchema, serializeEditorJson } from '../shared/editor-schema';

/** Device storage is deliberately separate from every server account and session. */
const DATABASE = 'luckynote-device-v1';
const USER_ID = 'local-device';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_CONTENT = 512 * 1024;
const STORES = ['meta', 'workspaces', 'notebooks', 'notes', 'attachments', 'documents', 'expenses', 'mutations'] as const;
type StoreName = typeof STORES[number];
type RecordValue = Record<string, unknown>;
type DeviceUser = User & { emailVerified: false; identityProvider: 'local' };
type LocalNotebook = Notebook & { workspaceId: string };
type LocalAttachment = Omit<Attachment, 'url'> & { noteId: string; bytes: Blob };
type LocalExpense = Expense & { workspaceId: string };
type Result = { status: number; body: unknown; changed?: boolean };
type SavedMutation = { id: string; hash: string; result: Result };
let databasePromise: Promise<IDBDatabase> | undefined;
const objectUrls = new Map<string, string>();
const mimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'application/pdf']);

class LocalError extends Error {
  constructor(public status: number, message: string, public code = 'VALIDATION') { super(message); }
}
const fail = (message: string, code = 'VALIDATION'): never => { throw new LocalError(400, message, code); };
const missing = (): never => { throw new LocalError(404, '找不到此裝置上的資料', 'NOT_FOUND'); };
const serverRequired = (): never => { throw new LocalError(503, '此功能需要連接自行部署的伺服器；裝置模式不會建立群組、外部連線或傳送資料。', 'LOCAL_SERVER_REQUIRED'); };
function object(value: unknown, label = '資料'): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label}格式不正確`);
  return value as RecordValue;
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\u0000')) fail(`${label}格式不正確或超過長度限制`);
  return value as string;
}
function keys(value: RecordValue, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label}含有不支援的欄位`, 'IMPORT_FORMAT');
}
function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error || new Error('IndexedDB request failed')); });
}
function transaction<T>(db: IDBDatabase, stores: readonly StoreName[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...stores], mode);
    let result: T; let failure: unknown;
    const abort = () => { failure = signal?.reason || new DOMException('The operation was aborted.', 'AbortError'); try { tx.abort(); } catch { /* Already committed. */ } };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => { cleanup(); resolve(result); };
    tx.onabort = () => { cleanup(); reject(failure || tx.error || new Error('IndexedDB transaction aborted')); };
    tx.onerror = () => { failure ||= tx.error; };
    action(tx).then(value => { result = value; }, error => { failure = error; try { tx.abort(); } catch { cleanup(); reject(error); } });
  });
}
const get = <T>(tx: IDBTransaction, store: StoreName, id: string) => request<T | undefined>(tx.objectStore(store).get(id));
const all = <T>(tx: IDBTransaction, store: StoreName) => request<T[]>(tx.objectStore(store).getAll());
const put = (tx: IDBTransaction, store: StoreName, value: unknown) => request(tx.objectStore(store).put(value));
const remove = (tx: IDBTransaction, store: StoreName, id: string) => request(tx.objectStore(store).delete(id));
const changed = () => window.dispatchEvent(new Event('luckynote:local-change'));

function newNote(workspaceId: string, value: Pick<Note, 'title' | 'content' | 'tags' | 'notebookId' | 'template'>): Note {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), workspaceId, ...value, version: 1, metadataVersion: 1, contentRevision: 0, contentMode: 'plain', createdAt: now, updatedAt: now };
}
async function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new LocalError(503, '此瀏覽器無法使用 IndexedDB，資料尚未儲存。', 'LOCAL_STORAGE_UNAVAILABLE')); return; }
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => { for (const name of STORES) if (!opening.result.objectStoreNames.contains(name)) opening.result.createObjectStore(name, { keyPath: 'id' }); };
    opening.onerror = () => reject(opening.error || new Error('Unable to open IndexedDB'));
    opening.onblocked = () => reject(new LocalError(503, '請關閉其他舊版本分頁後重新開啟，裝置資料尚未更新。', 'LOCAL_STORAGE_BLOCKED'));
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      void transaction(db, ['meta', 'workspaces', 'notes'], 'readwrite', async tx => {
        if (await get(tx, 'meta', 'profile')) return;
        const profile: DeviceUser = { id: USER_ID, name: '此裝置', email: 'local-only', avatar: '', emailVerified: false, identityProvider: 'local' };
        await put(tx, 'meta', { id: 'profile', value: profile });
        const workspace: Workspace = { id: crypto.randomUUID(), name: '此裝置的私人筆記', type: 'private', role: 'owner' };
        await put(tx, 'workspaces', workspace);
        // Only explicitly labelled preview builds receive synthetic starter content.
        if (import.meta.env.VITE_DEMO_SEED === 'true') for (const templateId of ['travel', 'shopping', 'sop']) {
          const template = templates.find(item => item.id === templateId)!;
          await put(tx, 'notes', newNote(workspace.id, { title: `【示範】${template.zh}`, content: `> 此為示範內容，僅儲存在此裝置，可編輯或刪除。\n\n${template.zhBody}`, tags: ['示範'], notebookId: null, template: template.id }));
        }
      }).then(() => resolve(db), error => { db.close(); reject(error); });
    };
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}
async function profile(tx: IDBTransaction): Promise<DeviceUser> {
  const record = await get<{ id: string; value: DeviceUser }>(tx, 'meta', 'profile');
  if (!record) return missing();
  return record.value;
}
async function workspace(tx: IDBTransaction, id: string): Promise<Workspace> { return await get<Workspace>(tx, 'workspaces', id) || missing(); }
async function note(tx: IDBTransaction, id: string): Promise<Note> { return await get<Note>(tx, 'notes', id) || missing(); }
async function validateNote(tx: IDBTransaction, body: RecordValue, workspaceId: string): Promise<Pick<Note, 'title' | 'content' | 'tags' | 'notebookId' | 'template'>> {
  const title = text(body.title ?? '未命名筆記', '標題', 200).trim();
  const content = text(body.content ?? '', '內容', MAX_CONTENT, true);
  const rawTags = body.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 30) fail('最多 30 個標籤');
  const tags = [...new Set((rawTags as unknown[]).map(tag => text(tag, '標籤', 40).trim()))];
  const notebookId = body.notebookId === undefined || body.notebookId === null || body.notebookId === '' ? null : text(body.notebookId, '筆記本', 100);
  if (notebookId && (await get<LocalNotebook>(tx, 'notebooks', notebookId))?.workspaceId !== workspaceId) fail('筆記本不屬於此工作空間', 'NOTEBOOK_SCOPE');
  return { title, content, tags, notebookId, template: text(body.template ?? 'blank', '模板', 50) };
}
function decodeBase64(value: unknown, max = MAX_FILE): Uint8Array {
  const encoded = text(value, '檔案內容', Math.ceil(max * 4 / 3) + 8);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) fail('Base64 格式不正確');
  let raw: string;
  try { raw = atob(encoded); } catch { return fail('Base64 格式不正確'); }
  if (!raw.length || raw.length > max) throw new LocalError(413, '附件上限為 20 MB', 'TOO_LARGE');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function validBytes(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === 'image/png') return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === 'image/jpeg') return starts(255, 216, 255);
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'application/pdf') return ascii(0, 5) === '%PDF-';
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (mime.endsWith('/webm')) return starts(26, 69, 223, 163);
  return ['video/mp4', 'video/quicktime', 'audio/mp4'].includes(mime) && ascii(4, 8) === 'ftyp';
}
const fileJson = (file: LocalAttachment): Attachment => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, url: `local-attachment:${file.id}` });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',') + '}';
  return JSON.stringify(value);
}
async function hashBody(body: RecordValue): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function cacheResult(result: Result): Result {
  if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body)) return result;
  const body = result.body as RecordValue;
  for (const kind of ['note', 'workspace', 'notebook', 'expense', 'attachment'] as const) {
    const value = body[kind];
    if (value && typeof value === 'object' && typeof (value as RecordValue).id === 'string') return { ...result, body: { localResultReference: kind, id: (value as RecordValue).id } };
  }
  return result;
}
async function replayResult(tx: IDBTransaction, result: Result): Promise<Result> {
  const body = result.body as RecordValue | null;
  if (!body || typeof body !== 'object' || typeof body.localResultReference !== 'string' || typeof body.id !== 'string') return { ...result, changed: false };
  const kind = body.localResultReference;
  const stores: Record<string, StoreName> = { note: 'notes', workspace: 'workspaces', notebook: 'notebooks', expense: 'expenses', attachment: 'attachments' };
  const value = await get<RecordValue>(tx, stores[kind], body.id);
  if (!value) throw new LocalError(410, '這次操作建立的資料已刪除，不會因重送而重新建立。', 'IDEMPOTENCY_RESULT_DELETED');
  const output = kind === 'attachment' ? fileJson(value as unknown as LocalAttachment) : kind === 'notebook' ? { id: value.id, name: value.name } : kind === 'expense' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'workspaceId')) : value;
  return { ...result, body: { [kind]: output }, changed: false };
}
async function deleteNote(tx: IDBTransaction, id: string): Promise<void> {
  await remove(tx, 'notes', id); await remove(tx, 'documents', id);
  for (const file of await all<LocalAttachment>(tx, 'attachments')) if (file.noteId === id) await remove(tx, 'attachments', file.id);
}
async function route(tx: IDBTransaction, path: string, method: string, body: RecordValue): Promise<Result> {
  const ok = (value: unknown, status = 200, mutation = false): Result => ({ status, body: value, changed: mutation });
  if (path === '/api/session' && method === 'GET') return ok({ user: await profile(tx), csrfToken: '', googleConfigured: false, localAuthEnabled: false, deviceOnly: true });
  if (path === '/api/health' && method === 'GET') return ok({ status: 'ok', storage: 'indexeddb', collaboration: 'device-only', deviceOnly: true });
  if (path === '/api/auth/logout' && method === 'POST') return ok({ ok: true, deviceOnly: true, dataRetained: true });
  if (/^\/api\/(?:auth|integrations|oauth|ai|tools)(?:\/|$)/.test(path)) return serverRequired();
  if (path === '/api/profile' && method === 'PATCH') {
    const previous = await profile(tx);
    const name = body.name === undefined ? previous.name : text(body.name, '名稱', 100).trim();
    const avatar = body.avatar === undefined ? previous.avatar || '' : text(body.avatar, '頭像', 2 * 1024 * 1024, true);
    if (avatar) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(avatar);
      if (!match || !validBytes(decodeBase64(match[2], 2 * 1024 * 1024), match[1])) fail('頭像需要 PNG、JPEG 或 WebP 圖片');
    }
    const user = { ...previous, name, avatar }; await put(tx, 'meta', { id: 'profile', value: user }); return ok({ user }, 200, true);
  }
  if (path === '/api/workspaces') {
    if (method === 'GET') return ok({ workspaces: await all<Workspace>(tx, 'workspaces') });
    if (method === 'POST') {
      if (body.type === 'group') return serverRequired();
      if (body.type !== 'private') fail('裝置模式僅支援私人工作空間');
      const item: Workspace = { id: crypto.randomUUID(), name: text(body.name, '工作空間名稱', 100).trim(), type: 'private', role: 'owner' };
      await put(tx, 'workspaces', item); return ok({ workspace: item }, 201, true);
    }
  }
  const workspaceRoute = /^\/api\/workspaces\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (workspaceRoute) {
    const item = await workspace(tx, workspaceRoute[1]); const resource = workspaceRoute[2] || '';
    if (/^(?:ai|tools|integrations|drive|calendar|gmail|line)(?:\/|$)/.test(resource)) return serverRequired();
    if (!resource && method === 'GET') return ok({ workspace: item });
    if (!resource && method === 'PATCH') { if (body.type && body.type !== 'private') return serverRequired(); const updated = { ...item, name: text(body.name, '工作空間名稱', 100).trim() }; await put(tx, 'workspaces', updated); return ok({ workspace: updated }, 200, true); }
    if (!resource && method === 'DELETE') {
      if ((await all(tx, 'workspaces')).length <= 1) fail('請保留至少一個私人工作空間');
      for (const value of await all<Note>(tx, 'notes')) if (value.workspaceId === item.id) await deleteNote(tx, value.id);
      for (const store of ['notebooks', 'expenses'] as const) for (const value of await all<{ id: string; workspaceId: string }>(tx, store)) if (value.workspaceId === item.id) await remove(tx, store, value.id);
      await remove(tx, 'workspaces', item.id); return ok({ ok: true }, 200, true);
    }
    if (resource === 'members' && method === 'GET') return ok({ members: [{ ...await profile(tx), role: 'owner' }], deviceOnly: true });
    if (resource.startsWith('members') || resource === 'events') return serverRequired();
    if (resource === 'notes') {
      if (method === 'GET') return ok({ notes: (await all<Note>(tx, 'notes')).filter(value => value.workspaceId === item.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)) });
      if (method === 'POST') { const value = newNote(item.id, await validateNote(tx, body, item.id)); await put(tx, 'notes', value); return ok({ note: value }, 201, true); }
    }
    if (resource === 'notebooks') {
      const books = (await all<LocalNotebook>(tx, 'notebooks')).filter(value => value.workspaceId === item.id);
      if (method === 'GET') return ok({ notebooks: books.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) });
      if (method === 'POST') {
        const name = text(body.name, '筆記本名稱', 100).trim(); const existing = books.find(book => book.name === name);
        if (existing) return ok({ notebook: { id: existing.id, name } });
        const book: LocalNotebook = { id: crypto.randomUUID(), workspaceId: item.id, name }; await put(tx, 'notebooks', book); return ok({ notebook: { id: book.id, name } }, 201, true);
      }
    }
    if (resource.startsWith('notebooks/')) {
      const bookId = resource.slice('notebooks/'.length); const book = await get<LocalNotebook>(tx, 'notebooks', bookId);
      if (!book || book.workspaceId !== item.id) return missing();
      if (method === 'GET') return ok({ notebook: { id: book.id, name: book.name } });
      if (method === 'PATCH') { const name = text(body.name, '筆記本名稱', 100).trim(); if ((await all<LocalNotebook>(tx, 'notebooks')).some(other => other.workspaceId === item.id && other.id !== bookId && other.name === name)) throw new LocalError(409, '已有同名筆記本', 'DUPLICATE'); await put(tx, 'notebooks', { ...book, name }); return ok({ notebook: { id: bookId, name } }, 200, true); }
      if (method === 'DELETE') { for (const value of await all<Note>(tx, 'notes')) if (value.workspaceId === item.id && value.notebookId === bookId) await put(tx, 'notes', { ...value, notebookId: null, version: value.version + 1, metadataVersion: value.metadataVersion + 1, updatedAt: new Date().toISOString() }); await remove(tx, 'notebooks', bookId); return ok({ ok: true }, 200, true); }
    }
    if (resource === 'expenses') {
      if (method === 'GET') return ok({ expenses: (await all<LocalExpense>(tx, 'expenses')).filter(value => value.workspaceId === item.id).map(({ workspaceId: _workspaceId, ...value }) => value), balances: [{ userId: USER_ID, name: (await profile(tx)).name, balance: 0 }], settlements: [], currency: 'TWD', deviceOnly: true });
      if (method === 'POST') {
        if (body.currency !== undefined && body.currency !== 'TWD') fail('此版本僅支援 TWD，不能自動換匯', 'CURRENCY');
        if (!Number.isSafeInteger(body.amount) || Number(body.amount) <= 0 || Number(body.amount) > 1_000_000_000) fail('金額須為正整數最小幣值，最多 1,000,000,000');
        if (body.payerId !== USER_ID || !Array.isArray(body.participantIds) || body.participantIds.length !== 1 || body.participantIds[0] !== USER_ID) return serverRequired();
        const expense: LocalExpense = { id: crypto.randomUUID(), workspaceId: item.id, description: text(body.description, '費用說明', 200).trim(), amount: Number(body.amount), payerId: USER_ID, participantIds: [USER_ID], createdAt: new Date().toISOString() };
        await put(tx, 'expenses', expense); const { workspaceId: _workspaceId, ...value } = expense; return ok({ expense: value }, 201, true);
      }
    }
    if (resource === 'settlements' && method === 'GET') return ok({ confirmations: [], deviceOnly: true });
    if (resource.startsWith('settlements')) return serverRequired();
    if (resource === 'export' && method === 'GET') return ok({ format: 'gathernote-workspace', formatVersion: 1, exportedAt: new Date().toISOString(), workspaceName: item.name, notes: (await all<Note>(tx, 'notes')).filter(value => value.workspaceId === item.id), notebooks: (await all<LocalNotebook>(tx, 'notebooks')).filter(value => value.workspaceId === item.id).map(({ id, name }) => ({ id, name })), attachmentsIncluded: false, notice: '此 JSON 僅包含筆記內容投影與筆記本；不含附件、協作歷史、記帳或個人設定。裝置資料不會自動同步到伺服器。' });
    if (resource === 'import' && method === 'POST') return importArchive(tx, item.id, body.archive);
  }
  const noteRoute = /^\/api\/notes\/([^/]+)(?:\/(attachments|collaboration))?$/.exec(path);
  if (noteRoute) {
    const value = await note(tx, noteRoute[1]); await workspace(tx, value.workspaceId);
    if (noteRoute[2] === 'collaboration') return serverRequired();
    if (noteRoute[2] === 'attachments') {
      if (method === 'GET') return ok({ attachments: (await all<LocalAttachment>(tx, 'attachments')).filter(file => file.noteId === value.id).map(fileJson) });
      if (method === 'POST') {
        const mime = text(body.mime, '檔案類型', 100).toLowerCase(); if (!mimes.has(mime)) throw new LocalError(415, '僅支援圖片、影片、音訊及 PDF；不接受 SVG／HTML', 'UNSUPPORTED_FILE');
        const bytes = decodeBase64(body.data); if (!validBytes(bytes, mime)) throw new LocalError(415, '檔案內容與宣告類型不一致', 'FILE_SIGNATURE');
        const name = [...text(body.name, '檔案名稱', 200)].map(char => char.charCodeAt(0) < 32 || char === '/' || char === '\\' ? '_' : char).join('');
        const file: LocalAttachment = { id: crypto.randomUUID(), noteId: value.id, name, mime, size: bytes.byteLength, bytes: new Blob([new Uint8Array(bytes)], { type: mime }) };
        await put(tx, 'attachments', file); return ok({ attachment: fileJson(file) }, 201, true);
      }
    } else {
      if (method === 'GET') return ok({ note: value });
      if (method === 'PATCH') {
        if (value.contentMode === 'yjs-v1' && body.content !== undefined) throw new LocalError(409, '請透過裝置文件編輯器更新內容', 'CRDT_CONTENT_OWNED');
        const check = body.metadataVersion !== undefined ? body.metadataVersion === value.metadataVersion : body.version === value.version;
        if (!check) throw new LocalError(409, '筆記已更新，請重新載入並比較', 'VERSION_CONFLICT');
        const fields = await validateNote(tx, { ...value, ...body }, value.workspaceId);
        const updated: Note = { ...value, ...fields, version: value.version + 1, metadataVersion: value.metadataVersion + 1, updatedAt: new Date().toISOString() };
        await put(tx, 'notes', updated); return ok({ note: updated }, 200, true);
      }
      if (method === 'DELETE') { if (body.version !== value.version) throw new LocalError(409, '筆記已更新，請重新載入後刪除', 'VERSION_CONFLICT'); await deleteNote(tx, value.id); return ok({ ok: true }, 200, true); }
    }
  }
  const attachmentRoute = /^\/api\/(files|attachments)\/([^/]+)$/.exec(path);
  if (attachmentRoute) {
    const file = await get<LocalAttachment>(tx, 'attachments', attachmentRoute[2]); if (!file) return missing(); await note(tx, file.noteId);
    if (method === 'GET' || method === 'HEAD') return { status: 200, body: file.bytes };
    if (method === 'DELETE' && attachmentRoute[1] === 'attachments') { await remove(tx, 'attachments', file.id); return ok({ ok: true }, 200, true); }
  }
  const expenseRoute = /^\/api\/expenses\/([^/]+)$/.exec(path);
  if (expenseRoute && method === 'DELETE') { const value = await get<LocalExpense>(tx, 'expenses', expenseRoute[1]); if (!value) return missing(); await workspace(tx, value.workspaceId); await remove(tx, 'expenses', value.id); return ok({ ok: true }, 200, true); }
  throw new LocalError(404, '裝置模式不支援此 API 路徑', 'NOT_FOUND');
}

async function importArchive(tx: IDBTransaction, workspaceId: string, raw: unknown): Promise<Result> {
  const archive = object(raw, '匯入檔案');
  keys(archive, ['format', 'formatVersion', 'exportedAt', 'workspaceName', 'notes', 'notebooks', 'attachmentsIncluded', 'notice'], '匯入檔案');
  if (archive.format !== 'gathernote-workspace' || archive.formatVersion !== 1 || !Array.isArray(archive.notes) || archive.notes.length > 500 || !Array.isArray(archive.notebooks) || archive.notebooks.length > 500 || (archive.attachmentsIncluded !== undefined && archive.attachmentsIncluded !== false)) fail('匯入格式不正確或超過 500 筆限制', 'IMPORT_FORMAT');
  if (archive.exportedAt !== undefined && (typeof archive.exportedAt !== 'string' || !Number.isFinite(Date.parse(archive.exportedAt)))) fail('匯出時間格式不正確', 'IMPORT_FORMAT');
  for (const field of ['workspaceName', 'notice']) if (archive[field] !== undefined) text(archive[field], field, 1000, true);
  const mapping = new Map<string, string>(); let notebookCount = 0;
  const books = (await all<LocalNotebook>(tx, 'notebooks')).filter(book => book.workspaceId === workspaceId);
  for (const rawBook of archive.notebooks as unknown[]) {
    const book = object(rawBook, '筆記本'); keys(book, ['id', 'name'], '筆記本');
    const oldId = text(book.id, '來源筆記本 ID', 100); const name = text(book.name, '筆記本名稱', 100).trim();
    if (mapping.has(oldId)) fail('重複的來源筆記本 ID', 'IMPORT_FORMAT');
    let existing = books.find(value => value.name === name);
    if (!existing) { existing = { id: crypto.randomUUID(), workspaceId, name }; books.push(existing); await put(tx, 'notebooks', existing); notebookCount++; }
    mapping.set(oldId, existing.id);
  }
  const ids = new Set<string>();
  for (const rawNote of archive.notes as unknown[]) {
    const item = object(rawNote, '筆記');
    keys(item, ['id', 'workspaceId', 'title', 'content', 'tags', 'notebookId', 'template', 'version', 'metadataVersion', 'contentRevision', 'contentMode', 'createdAt', 'updatedAt'], '筆記');
    for (const field of ['title', 'content', 'template']) if (typeof item[field] !== 'string') fail(`筆記 ${field} 格式不正確`, 'IMPORT_FORMAT');
    if (!Array.isArray(item.tags) || (item.notebookId !== null && typeof item.notebookId !== 'string')) fail('筆記標籤或筆記本格式不正確', 'IMPORT_FORMAT');
    if (item.id !== undefined) { const id = text(item.id, '筆記 ID', 100); if (ids.has(id)) fail('重複的筆記 ID', 'IMPORT_FORMAT'); ids.add(id); }
    if (item.workspaceId !== undefined) text(item.workspaceId, '工作空間 ID', 100);
    for (const field of ['version', 'metadataVersion', 'contentRevision']) if (item[field] !== undefined && (!Number.isSafeInteger(item[field]) || Number(item[field]) < (field === 'contentRevision' ? 0 : 1))) fail('筆記版本格式不正確', 'IMPORT_FORMAT');
    if (item.contentMode !== undefined && !['plain', 'yjs-v1'].includes(String(item.contentMode))) fail('文件格式不正確', 'IMPORT_FORMAT');
    for (const field of ['createdAt', 'updatedAt']) if (item[field] !== undefined && (typeof item[field] !== 'string' || !Number.isFinite(Date.parse(item[field] as string)))) fail('筆記時間格式不正確', 'IMPORT_FORMAT');
    if (item.notebookId && !mapping.has(String(item.notebookId))) fail('來源筆記本不存在', 'IMPORT_FORMAT');
    const value = await validateNote(tx, { ...item, notebookId: item.notebookId ? mapping.get(String(item.notebookId)) : null }, workspaceId);
    await put(tx, 'notes', newNote(workspaceId, value));
  }
  return { status: 201, body: { imported: (archive.notes as unknown[]).length, notebooks: notebookCount }, changed: true };
}

async function resolveFiles(db: IDBDatabase, value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Promise.all(value.map(item => resolveFiles(db, item)));
  const item = value as RecordValue;
  if (typeof item.url === 'string' && item.url.startsWith('local-attachment:')) {
    const id = item.url.slice('local-attachment:'.length);
    let url = objectUrls.get(id);
    if (!url) { const file = await transaction(db, ['attachments'], 'readonly', tx => get<LocalAttachment>(tx, 'attachments', id)); if (!file) return missing(); url = URL.createObjectURL(file.bytes); objectUrls.set(id, url); }
    return { ...item, url };
  }
  return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await resolveFiles(db, entry)])));
}
/** No network requests, credentials or fabricated integration results are used here. */
export async function localRequest(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    options.signal?.throwIfAborted();
    if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('#')) throw new LocalError(400, '僅接受本機 API 路徑', 'LOCAL_PATH');
    const url = new URL(path, 'https://device.invalid');
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new LocalError(405, '不支援此方法', 'METHOD');
    const mutation = !['GET', 'HEAD'].includes(method);
    let body: RecordValue = {};
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body !== 'string') fail('API 請求需要 JSON 字串');
      if ((options.body as string).length > 29 * 1024 * 1024) throw new LocalError(413, '請求內容過大', 'TOO_LARGE');
      try { body = object(JSON.parse(options.body as string)); } catch (error) { if (error instanceof LocalError) throw error; fail('JSON 格式不正確'); }
    }
    if (url.pathname.endsWith('/import') && typeof options.body === 'string' && new TextEncoder().encode(options.body).byteLength > 10 * 1024 * 1024) throw new LocalError(413, '匯入檔案不可超過 10 MB', 'TOO_LARGE');
    const mutationId = body.clientMutationId === undefined ? '' : text(body.clientMutationId, '重複操作識別碼', 100);
    const hash = mutation && mutationId ? await hashBody(body) : '';
    const db = await openDatabase();
    const result = await transaction(db, STORES, mutation ? 'readwrite' : 'readonly', async tx => {
      const id = `${method}:${url.pathname}:${mutationId}`;
      if (mutationId) {
        const saved = await get<SavedMutation>(tx, 'mutations', id);
        if (saved) { if (saved.hash !== hash) throw new LocalError(409, '重複操作識別碼已用於不同內容', 'IDEMPOTENCY_CONFLICT'); return replayResult(tx, saved.result); }
      }
      const output = await route(tx, url.pathname, method, body);
      if (mutation && mutationId) await put(tx, 'mutations', { id, hash, result: cacheResult(output) } satisfies SavedMutation);
      return output;
    }, options.signal);
    if (result.changed) {
      if (method === 'DELETE') {
        const remaining = new Set(await transaction(db, ['attachments'], 'readonly', tx => request(tx.objectStore('attachments').getAllKeys())));
        for (const [id, url] of objectUrls) if (!remaining.has(id)) { URL.revokeObjectURL(url); objectUrls.delete(id); }
      }
      changed();
    }
    if (result.body instanceof Blob) return new Response(method === 'HEAD' ? null : result.body, { status: result.status, headers: { 'Content-Type': result.body.type, 'Content-Length': String(result.body.size), 'Cache-Control': 'no-store' } });
    return new Response(JSON.stringify(await resolveFiles(db, result.body)), { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const failure = error instanceof LocalError ? error : new LocalError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 507 : 503, error instanceof DOMException && error.name === 'QuotaExceededError' ? '裝置儲存空間不足，變更未儲存。請先匯出資料並釋放空間。' : '裝置儲存失敗，資料尚未確認儲存；請保留內容並重試。', 'LOCAL_STORAGE_ERROR');
    return new Response(JSON.stringify({ error: failure.message, code: failure.code }), { status: failure.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}

export async function getLocalNote(noteId: string): Promise<Note> {
  return transaction(await openDatabase(), ['notes'], 'readonly', tx => note(tx, noteId));
}
export async function readLocalDocument(noteId: string): Promise<Uint8Array | null> {
  return transaction(await openDatabase(), ['notes', 'documents'], 'readonly', async tx => { await note(tx, noteId); const saved = await get<{ id: string; state: Uint8Array }>(tx, 'documents', noteId); return saved ? new Uint8Array(saved.state) : null; });
}
const sameBytes = (first: Uint8Array, second: Uint8Array) => first.byteLength === second.byteLength && first.every((byte, index) => byte === second[index]);
function validateDocumentInput(state: Uint8Array, markdown: string): void {
  if (!(state instanceof Uint8Array) || !state.byteLength || state.byteLength > 8 * 1024 * 1024) throw new LocalError(413, '裝置文件超過大小限制', 'CRDT_TOO_LARGE');
  text(markdown, '筆記內容', MAX_CONTENT, true);
}
function projectDocument(state: Uint8Array): { state: Uint8Array; projection: string } {
  if (state.byteLength > 8 * 1024 * 1024) throw new LocalError(413, '裝置文件超過大小限制', 'CRDT_TOO_LARGE');
  const document = new Y.Doc();
  try {
    document.getXmlFragment(COLLAB_FIELD); document.getMap('metadata'); Y.applyUpdate(document, state);
    if (document.store.pendingStructs || document.store.pendingDs) fail('裝置文件缺少相依更新', 'CRDT_INVALID');
    const json = yDocToProsemirrorJSON(document, COLLAB_FIELD);
    editorSchema.nodeFromJSON(json).check();
    let projection = serializeEditorJson(json);
    const sketch = document.getMap('metadata').get('sketch');
    if (sketch !== undefined && (typeof sketch !== 'string' || sketch.length > 250_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(sketch))) fail('手寫資料格式不正確', 'CRDT_INVALID');
    if (sketch) projection += '\n<!--luckynote-sketch:' + sketch + '-->';
    text(projection, '筆記內容', MAX_CONTENT, true);
    if (new TextEncoder().encode(projection).byteLength > 2 * 1024 * 1024) throw new LocalError(413, '裝置文件超過大小限制', 'CRDT_TOO_LARGE');
    const canonicalState = Y.encodeStateAsUpdate(document);
    if (canonicalState.byteLength > 8 * 1024 * 1024) throw new LocalError(413, '裝置文件超過大小限制', 'CRDT_TOO_LARGE');
    return { state: canonicalState, projection };
  } finally { document.destroy(); }
}
/** Compare-and-set bootstrap: racing tabs must share one initial set of Yjs item IDs. */
export async function initializeLocalDocument(noteId: string, state: Uint8Array, markdown: string, expectedVersion?: number): Promise<Uint8Array> {
  validateDocumentInput(state, markdown);
  const copy = new Uint8Array(state);
  const result = await transaction(await openDatabase(), ['notes', 'documents'], 'readwrite', async tx => {
    const current = await note(tx, noteId);
    const existing = await get<{ id: string; state: Uint8Array }>(tx, 'documents', noteId);
    if (existing) return { state: new Uint8Array(existing.state), changed: false };
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new LocalError(409, '筆記已更新，請重新載入後建立裝置文件', 'VERSION_CONFLICT');
    const value = projectDocument(copy);
    await put(tx, 'documents', { id: noteId, state: value.state });
    await put(tx, 'notes', { ...current, content: value.projection, contentMode: 'yjs-v1', version: current.version + 1, contentRevision: current.contentRevision + 1, updatedAt: new Date().toISOString() });
    return { state: new Uint8Array(value.state), changed: true };
  });
  if (result.changed) changed();
  return result.state;
}
/** Atomically merge concurrent tab state and derive the projection from the winner. */
export async function storeLocalDocument(noteId: string, state: Uint8Array, markdown: string): Promise<void> {
  validateDocumentInput(state, markdown);
  const copy = new Uint8Array(state);
  const modified = await transaction(await openDatabase(), ['notes', 'documents'], 'readwrite', async tx => {
    const current = await note(tx, noteId);
    const previous = await get<{ id: string; state: Uint8Array }>(tx, 'documents', noteId);
    const merged = previous ? Y.mergeUpdates([previous.state, copy]) : copy;
    if (previous && sameBytes(previous.state, merged)) return false;
    const value = projectDocument(merged);
    if (previous && sameBytes(previous.state, value.state)) return false;
    await put(tx, 'documents', { id: noteId, state: value.state });
    await put(tx, 'notes', { ...current, content: value.projection, contentMode: 'yjs-v1', version: current.version + 1, contentRevision: current.contentRevision + 1, updatedAt: new Date().toISOString() });
    return true;
  });
  if (modified) changed();
}
