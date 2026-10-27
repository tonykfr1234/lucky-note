import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { HttpError, type IntegrationContext, type User, type Membership } from './types.js';
import { handleIntegrationRoutes } from './integrations.js';

interface SessionRow { user_id: string; csrf: string; expires_at: number }
interface UserRow { id: string; name: string; email: string; avatar: string; password_hash: string | null; google_sub: string | null }
interface NoteRow { id: string; workspace_id: string; title: string; content: string; tags: string; notebook_id: string | null; template: string; version: number; created_at: string; updated_at: string }
interface FileRow { id: string; note_id: string; name: string; mime: string; size: number; workspace_id: string }
interface ExpenseRow { id: string; workspace_id: string; description: string; amount: number; payer_id: string; participant_ids: string; created_at: string }
export interface AppOptions {
  dataDir?: string; distDir?: string; env?: NodeJS.ProcessEnv;
  integrationHandler?: (ctx: IntegrationContext) => Promise<boolean>;
}

const MAX_FILE = 20 * 1024 * 1024;
const MAX_BODY = Math.ceil(MAX_FILE * 4 / 3) + 65536;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'application/pdf']);
const MIME_BY_EXT: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function string(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new HttpError(400, `${name} 格式或長度不正確`, 'VALIDATION');
  return value;
}
function email(value: unknown): string {
  const result = string(value, 'Email', 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'Email 格式不正確', 'VALIDATION');
  return result;
}
function safeUser(row: UserRow): User { return { id: row.id, name: row.name, email: row.email, avatar: row.avatar }; }
function noteJson(row: NoteRow) {
  return { id: row.id, workspaceId: row.workspace_id, title: row.title, content: row.content, tags: JSON.parse(row.tags) as string[], notebookId: row.notebook_id, template: row.template, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function fileJson(row: FileRow) { return { id: row.id, name: row.name, mime: row.mime, size: row.size, url: `/api/files/${row.id}` }; }
function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password: string, stored: string | null): boolean {
  if (!stored) { scryptSync(password, 'constant-time-missing-user', 64); return false; }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function parseCookie(req: IncomingMessage): string | null {
  return (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('gn_session='))?.slice(11) || null;
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '需要 application/json', 'CONTENT_TYPE');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new HttpError(413, '資料過大', 'TOO_LARGE');
  const chunks: Buffer[] = []; let length = 0;
  for await (const part of req) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part as string);
    length += buffer.length;
    if (length > MAX_BODY) throw new HttpError(413, '資料過大', 'TOO_LARGE');
    chunks.push(buffer);
  }
  if (!length) return {};
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new HttpError(400, 'JSON 格式不正確', 'VALIDATION'); }
}
function validFileBytes(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime.endsWith('/webm')) return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime.endsWith('/mp4') || mime === 'video/quicktime') return bytes.subarray(4, 8).toString() === 'ftyp';
  if (mime === 'audio/wav') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
  if (mime === 'audio/mpeg') return bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && ((bytes[1] || 0) & 224) === 224);
  return false;
}

export function validateConfiguration(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('正式模式需要至少 32 字元 SESSION_SECRET');
  if (!env.APP_ORIGIN || !/^https:\/\/[^\s]+$/.test(env.APP_ORIGIN) || new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN) throw new Error('正式模式需要完整 HTTPS APP_ORIGIN（不含尾端斜線）');
  if (env.AUTH_MODE === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Google 正式登入需要 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET');
  } else if (env.AUTH_MODE !== 'local' || env.ALLOW_LOCAL_AUTH !== 'true') throw new Error('正式模式需 Google 登入或明確 ALLOW_LOCAL_AUTH=true 與 AUTH_MODE=local');
}

export function createApp(options: AppOptions = {}) {
  const env = options.env || process.env;
  validateConfiguration(env);
  const dataDir = resolve(options.dataDir || env.DATA_DIR || 'data');
  const distDir = resolve(options.distDir || 'dist');
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'gathernote.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT,google_sub TEXT UNIQUE,avatar TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('private','group')),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE IF NOT EXISTS notebooks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,UNIQUE(workspace_id,name));
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '[]',notebook_id TEXT REFERENCES notebooks(id),template TEXT NOT NULL DEFAULT 'blank',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS notes_workspace ON notes(workspace_id,updated_at);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,description TEXT NOT NULL,amount INTEGER NOT NULL,payer_id TEXT NOT NULL REFERENCES users(id),participant_ids TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mutations(user_id TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,scope,key));
    CREATE TABLE IF NOT EXISTS settlement_confirmations(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),from_id TEXT NOT NULL REFERENCES users(id),to_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,confirmed_at TEXT);
    PRAGMA user_version=1;`);
  const secret = env.SESSION_SECRET || randomBytes(32).toString('hex');
  const tokenDigest = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const localAuthEnabled = env.AUTH_MODE !== 'google' && (env.NODE_ENV !== 'production' || env.ALLOW_LOCAL_AUTH === 'true');
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN);
  const streams = new Set<{ res: ServerResponse; workspaceId: string; userId: string; sessionId: string; timer: NodeJS.Timeout }>();
  const rates = new Map<string, { count: number; expires: number }>();
  const transaction = <T>(fn: () => T): T => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow | undefined;
  const lookupMembership = (workspaceId: string, userId: string) => db.prepare('SELECT w.id,w.id as workspaceId,w.name,w.type,m.user_id as userId,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?').get(workspaceId, userId) as unknown as Membership | undefined;
  function closeStream(stream: { res: ServerResponse; timer: NodeJS.Timeout }) { clearInterval(stream.timer); stream.res.end(); streams.delete(stream as never); }
  function streamAuthorized(stream: { sessionId: string; userId: string; workspaceId: string }) {
    return Boolean(db.prepare('SELECT id FROM sessions WHERE id=? AND expires_at>?').get(stream.sessionId, Date.now()) && lookupMembership(stream.workspaceId, stream.userId));
  }
  function broadcast(workspaceId: string, event: Record<string, unknown>) {
    for (const stream of streams) {
      if (!streamAuthorized(stream)) { closeStream(stream); continue; }
      if (stream.workspaceId === workspaceId) stream.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
  function newWorkspace(userId: string, name: string, type: string) {
    const id = randomUUID();
    db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run(id, name, type, new Date().toISOString());
    db.prepare('INSERT INTO members VALUES(?,?,?)').run(id, userId, 'owner');
    return { id, name, type, role: 'owner' };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, '不支援的方法');
        let decoded: string;
        try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, '路徑格式不正確'); }
        if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) throw new HttpError(400, '路徑格式不正確');
        const asset = resolve(distDir, `.${decoded}`);
        if (asset !== distDir && !asset.startsWith(`${distDir}${sep}`)) throw new HttpError(404, '找不到資源');
        const selected = existsSync(asset) && statSync(asset).isFile() ? asset : extname(decoded) ? null : join(distDir, 'index.html');
        if (!selected || !existsSync(selected)) throw new HttpError(404, '前端尚未建置，請先執行 npm run build');
        res.writeHead(200, { 'Content-Type': MIME_BY_EXT[extname(selected)] || 'application/octet-stream', 'Cache-Control': extname(selected) === '.html' || /(?:sw|service-worker)\.js$/.test(selected) ? 'no-cache' : 'public, max-age=3600' });
        res.end(req.method === 'HEAD' ? undefined : readFileSync(selected)); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      const rawToken = parseCookie(req);
      const sessionId = rawToken ? tokenDigest(rawToken) : '';
      const session = sessionId ? db.prepare('SELECT user_id,csrf,expires_at FROM sessions WHERE id=? AND expires_at>?').get(sessionId, Date.now()) as unknown as SessionRow | undefined : undefined;
      let user = session ? safeUser(getUser(session.user_id)!) : null;
      const requireUser = () => { if (!user) throw new HttpError(401, '請先登入', 'AUTH_REQUIRED'); return user; };
      const requireWorkspace = (id: string, write = false): Membership => {
        const current = requireUser();
        const membership = lookupMembership(id, current.id);
        if (!membership) throw new HttpError(404, '找不到工作空間', 'NOT_FOUND');
        if (write && membership.role === 'viewer') throw new HttpError(403, '此帳號僅有檢視權限', 'FORBIDDEN');
        return membership;
      };
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) {
        const origin = req.headers.origin;
        const host = req.headers.host || '';
        const configured = env.APP_ORIGIN;
        const actualOrigin = `http://${host}`;
        const devOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(actualOrigin) ? actualOrigin : '';
        if (origin && origin !== (configured || devOrigin)) throw new HttpError(403, '來源不允許', 'ORIGIN');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不允許跨站請求', 'ORIGIN');
        if (session && req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, '請重新整理後再試（CSRF）', 'CSRF');
        if (!session && !['/api/auth/register', '/api/auth/login'].includes(pathname)) throw new HttpError(401, '請先登入', 'AUTH_REQUIRED');
      }
      const body = await readBody(req);
      const createSession = (userId: string) => {
        if (sessionId) db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
        const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenDigest(token), userId, csrf, Date.now() + SESSION_MS);
        const secure = env.NODE_ENV === 'production' || env.APP_ORIGIN?.startsWith('https:');
        const previousCookies = res.getHeader('Set-Cookie');
        const cookies = previousCookies === undefined ? [] : Array.isArray(previousCookies) ? previousCookies.map(String) : [String(previousCookies)];
        cookies.push(`gn_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
        res.setHeader('Set-Cookie', cookies);
        return csrf;
      };
      const createGoogleSession = (profile: { sub: string; email: string; name: string; emailVerified: boolean }) => {
        if (!profile.emailVerified) throw new HttpError(403, 'Google 帳號尚未驗證 Email', 'UNVERIFIED_EMAIL');
        const sub = string(profile.sub, 'Google sub', 255); const address = email(profile.email);
        let row = db.prepare('SELECT * FROM users WHERE google_sub=?').get(sub) as unknown as UserRow | undefined;
        if (!row) {
          if (db.prepare('SELECT id FROM users WHERE email=?').get(address)) throw new HttpError(409, '此 Email 已有本機帳號，請使用原登入方式；尚未提供帳號連結', 'ACCOUNT_LINK_REQUIRED');
          const id = randomUUID();
          transaction(() => { db.prepare('INSERT INTO users(id,name,email,google_sub) VALUES(?,?,?,?)').run(id, string(profile.name || address, '名稱', 100), address, sub); newWorkspace(id, '私人筆記', 'private'); });
          row = getUser(id)!;
        }
        createSession(row.id); user = safeUser(row); return user;
      };
      const readAttachment = (id: string) => {
        requireUser();
        const file = db.prepare('SELECT a.*,n.workspace_id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=?').get(id) as unknown as FileRow | undefined;
        if (!file) throw new HttpError(404, '找不到附件', 'NOT_FOUND');
        requireWorkspace(file.workspace_id);
        const path = join(uploadDir, file.id);
        if (!existsSync(path)) throw new HttpError(404, '附件檔案遺失');
        return { id: file.id, name: file.name, mime: file.mime, size: file.size, workspaceId: file.workspace_id, bytes: readFileSync(path) };
      };
      const ctx: IntegrationContext = { req, res, url, body, db, user, env, json, requireUser, requireWorkspace, createGoogleSession, broadcast, readAttachment };
      if (await (options.integrationHandler || handleIntegrationRoutes)(ctx)) return;
      if (req.method === 'GET' && pathname === '/api/health') { json(200, { status: 'ok', version: '0.1.0', storage: 'sqlite' }); return; }
      if (req.method === 'GET' && pathname === '/api/session') { json(200, { user, csrfToken: session?.csrf || '', googleConfigured, localAuthEnabled }); return; }
      if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(pathname)) {
        if (!localAuthEnabled) throw new HttpError(403, '此部署未啟用本機密碼登入', 'LOCAL_AUTH_DISABLED');
        const rateKey = `${req.socket.remoteAddress || 'unknown'}:auth`;
        const now = Date.now(); const rate = rates.get(rateKey);
        if (rate && rate.expires > now && rate.count >= 30) throw new HttpError(429, '登入嘗試過多，請稍後再試', 'RATE_LIMIT');
        rates.set(rateKey, { count: rate && rate.expires > now ? rate.count + 1 : 1, expires: rate && rate.expires > now ? rate.expires : now + 60000 });
        const address = email(body.email); const password = string(body.password, '密碼', 200);
        if (password.length < 10) throw new HttpError(400, '密碼至少需要 10 個字元', 'VALIDATION');
        let row = db.prepare('SELECT * FROM users WHERE email=?').get(address) as unknown as UserRow | undefined;
        if (pathname.endsWith('register')) {
          if (row) throw new HttpError(409, '此 Email 已註冊', 'DUPLICATE_ACCOUNT');
          const id = randomUUID(); const name = string(body.name, '名稱', 100).trim(); const hash = passwordHash(password);
          transaction(() => { db.prepare('INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)').run(id, name, address, hash); newWorkspace(id, '私人筆記', 'private'); });
          row = getUser(id)!;
        } else if (!passwordMatches(password, row?.password_hash || null)) throw new HttpError(401, 'Email 或密碼不正確', 'INVALID_CREDENTIALS');
        const csrfToken = createSession(row!.id);
        json(pathname.endsWith('register') ? 201 : 200, { user: safeUser(row!), csrfToken, googleConfigured, localAuthEnabled }); return;
      }
      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        requireUser(); db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
        for (const stream of streams) if (stream.sessionId === sessionId) closeStream(stream);
        res.setHeader('Set-Cookie', `gn_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
        json(200, { ok: true }); return;
      }
      if (req.method === 'PATCH' && pathname === '/api/profile') {
        const current = requireUser();
        const name = body.name === undefined ? current.name : string(body.name, '名稱', 100).trim();
        const avatar = body.avatar === undefined ? current.avatar : string(body.avatar, '頭像', 2 * 1024 * 1024, true);
        if (avatar) {
          const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(avatar);
          if (!match || !validFileBytes(Buffer.from(match[2]!, 'base64'), match[1]!)) throw new HttpError(400, '頭像需要 PNG、JPEG 或 WebP 圖片');
        }
        db.prepare('UPDATE users SET name=?,avatar=? WHERE id=?').run(name, avatar, current.id);
        json(200, { user: safeUser(getUser(current.id)!) }); return;
      }
      if (pathname === '/api/workspaces') {
        const current = requireUser();
        if (req.method === 'GET') { json(200, { workspaces: db.prepare('SELECT w.id,w.name,w.type,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at,w.id').all(current.id) }); return; }
        if (req.method === 'POST') {
          const name = string(body.name, '工作空間名稱', 100).trim();
          if (!['private', 'group'].includes(String(body.type))) throw new HttpError(400, '工作空間類型不正確');
          json(201, { workspace: transaction(() => newWorkspace(current.id, name, String(body.type))) }); return;
        }
      }
      const wsRoute = /^\/api\/workspaces\/([^/]+)\/(members|notebooks|notes|events|expenses|settlements|export|import)(?:\/([^/]+))?$/.exec(pathname);
      if (wsRoute) {
        const workspaceId = wsRoute[1]!; const resource = wsRoute[2]!; const resourceId = wsRoute[3];
        const membership = requireWorkspace(workspaceId, req.method !== 'GET');
        const current = requireUser();
        if (resource === 'export' && req.method === 'GET') {
          const notes = (db.prepare('SELECT * FROM notes WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId) as unknown as NoteRow[]).map(noteJson);
          const notebooks = db.prepare('SELECT id,name FROM notebooks WHERE workspace_id=? ORDER BY name,id').all(workspaceId);
          json(200, { format: 'gathernote-workspace', formatVersion: 1, exportedAt: new Date().toISOString(), workspaceName: membership.name, notes, notebooks, attachmentsIncluded: false, notice: '此 JSON 僅包含筆記及筆記本，不包含附件、分帳、成員或帳號。完整備份請備份 data 目錄。' }); return;
        }
        if (resource === 'import' && req.method === 'POST') {
          const archive = body.archive as Record<string, unknown> | null;
          if (!archive || typeof archive !== 'object' || archive.format !== 'gathernote-workspace' || archive.formatVersion !== 1 || !Array.isArray(archive.notes) || archive.notes.length > 500 || !Array.isArray(archive.notebooks) || archive.notebooks.length > 500) throw new HttpError(400, '匯入檔案格式不正確或超過 500 筆限制', 'IMPORT_FORMAT');
          const response = idempotent(current.id, `import:${workspaceId}`, body, () => {
            const mapping = new Map<string, string>();
            let notebookCount = 0;
            for (const raw of archive.notebooks as unknown[]) {
              if (!raw || typeof raw !== 'object') throw new HttpError(400, '筆記本格式不正確');
              const item = raw as Record<string, unknown>; const oldId = string(item.id, '來源筆記本 ID', 100); const name = string(item.name, '筆記本名稱', 100).trim();
              const existing = db.prepare('SELECT id FROM notebooks WHERE workspace_id=? AND name=?').get(workspaceId, name) as { id: string } | undefined;
              const newId = existing?.id || randomUUID();
              if (!existing) { db.prepare('INSERT INTO notebooks VALUES(?,?,?)').run(newId, workspaceId, name); notebookCount++; }
              mapping.set(oldId, newId);
            }
            for (const raw of archive.notes as unknown[]) {
              if (!raw || typeof raw !== 'object') throw new HttpError(400, '筆記格式不正確');
              const item = raw as Record<string, unknown>;
              if (item.notebookId && !mapping.has(String(item.notebookId))) throw new HttpError(400, '匯入筆記所屬筆記本不存在');
              const value = validateNote({ ...item, notebookId: item.notebookId ? mapping.get(String(item.notebookId)) : null }, workspaceId);
              const now = new Date().toISOString();
              db.prepare('INSERT INTO notes(id,workspace_id,title,content,tags,notebook_id,template,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), workspaceId, value.title, value.content, JSON.stringify(value.tags), value.notebookId, value.template, now, now);
            }
            return { imported: (archive.notes as unknown[]).length, notebooks: notebookCount };
          });
          broadcast(workspaceId, { kind: 'notes' }); json(201, response); return;
        }
        if (resource === 'members') {
          if (req.method === 'GET') { json(200, { members: db.prepare('SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.role,u.name,u.id').all(workspaceId) }); return; }
          if (membership.role !== 'owner' || membership.type !== 'group') throw new HttpError(403, '只有群組擁有者可以管理成員', 'FORBIDDEN');
          if (req.method === 'POST') {
            const target = db.prepare('SELECT id FROM users WHERE email=?').get(email(body.email)) as { id: string } | undefined;
            if (!target) throw new HttpError(404, '此帳號尚未註冊；本版不會寄送邀請信', 'NOT_REGISTERED');
            if (!['editor', 'viewer'].includes(String(body.role))) throw new HttpError(400, '角色必須為 editor 或 viewer');
            if (target.id === current.id) throw new HttpError(400, '不可變更自己的擁有者權限');
            db.prepare('INSERT INTO members VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role').run(workspaceId, target.id, String(body.role));
            broadcast(workspaceId, { kind: 'members' }); json(200, { ok: true }); return;
          }
          if (req.method === 'DELETE' && resourceId) {
            if (resourceId === current.id) throw new HttpError(400, '不可移除擁有者');
            db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=? AND role<>?').run(workspaceId, resourceId, 'owner');
            broadcast(workspaceId, { kind: 'members' }); json(200, { ok: true }); return;
          }
        }
        if (resource === 'notebooks') {
          if (req.method === 'GET') { json(200, { notebooks: db.prepare('SELECT id,name FROM notebooks WHERE workspace_id=? ORDER BY name,id').all(workspaceId) }); return; }
          if (req.method === 'POST') {
            const name = string(body.name, '筆記本名稱', 100).trim();
            const existing = db.prepare('SELECT id,name FROM notebooks WHERE workspace_id=? AND name=?').get(workspaceId, name);
            if (existing) { json(200, { notebook: existing }); return; }
            const id = randomUUID(); db.prepare('INSERT INTO notebooks VALUES(?,?,?)').run(id, workspaceId, name);
            broadcast(workspaceId, { kind: 'notebooks' }); json(201, { notebook: { id, name } }); return;
          }
        }
        if (resource === 'events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`data: ${JSON.stringify({ kind: 'connected' })}\n\n`);
          const stream = { res, workspaceId, userId: current.id, sessionId, timer: setInterval(() => { if (!streamAuthorized(stream)) closeStream(stream); else res.write(': heartbeat\n\n'); }, 15000) };
          streams.add(stream); req.on('close', () => { clearInterval(stream.timer); streams.delete(stream); }); return;
        }
        if (resource === 'notes') {
          if (req.method === 'GET') {
            const rows = db.prepare('SELECT * FROM notes WHERE workspace_id=? ORDER BY updated_at DESC,id').all(workspaceId) as unknown as NoteRow[];
            json(200, { notes: rows.map(noteJson) }); return;
          }
          if (req.method === 'POST') {
            const response = idempotent(current.id, `notes:${workspaceId}`, body, () => {
              const value = validateNote(body, workspaceId); const now = new Date().toISOString(); const id = randomUUID();
              db.prepare('INSERT INTO notes(id,workspace_id,title,content,tags,notebook_id,template,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, workspaceId, value.title, value.content, JSON.stringify(value.tags), value.notebookId, value.template, now, now);
              return { note: noteJson(db.prepare('SELECT * FROM notes WHERE id=?').get(id) as unknown as NoteRow) };
            });
            broadcast(workspaceId, { kind: 'notes' }); json(201, response); return;
          }
        }
        if (resource === 'expenses') {
          if (req.method === 'GET') { json(200, expenseSummary(workspaceId)); return; }
          if (req.method === 'POST') {
            const result = idempotent(current.id, `expenses:${workspaceId}`, body, () => {
              const description = string(body.description, '費用說明', 200).trim();
              if (body.currency !== undefined && body.currency !== 'TWD') throw new HttpError(400, '此版本僅支援 TWD，請勿混用不同幣別', 'CURRENCY');
              if (!Number.isSafeInteger(body.amount) || Number(body.amount) <= 0 || Number(body.amount) > 1_000_000_000) throw new HttpError(400, '金額須為正整數最小幣值，最多 1,000,000,000');
              const payerId = string(body.payerId, '付款人', 100);
              if (!Array.isArray(body.participantIds) || !body.participantIds.length || body.participantIds.length > 100 || body.participantIds.some((x) => typeof x !== 'string')) throw new HttpError(400, '請選擇分帳成員');
              const participants = [...new Set(body.participantIds as string[])].sort();
              if (!lookupMembership(workspaceId, payerId) || participants.some((id) => !lookupMembership(workspaceId, id))) throw new HttpError(400, '付款人及分帳成員必須屬於此工作空間');
              const id = randomUUID(); const createdAt = new Date().toISOString();
              db.prepare('INSERT INTO expenses VALUES(?,?,?,?,?,?,?)').run(id, workspaceId, description, Number(body.amount), payerId, JSON.stringify(participants), createdAt);
              return { expense: { id, description, amount: body.amount, payerId, participantIds: participants, createdAt } };
            });
            broadcast(workspaceId, { kind: 'expenses' }); json(201, result); return;
          }
        }
        if (resource === 'settlements') {
          if (req.method === 'GET') { json(200, { confirmations: db.prepare('SELECT id,from_id as fromId,to_id as toId,amount,status,created_at as createdAt,confirmed_at as confirmedAt FROM settlement_confirmations WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId) }); return; }
          if (req.method === 'POST') {
            const toId = string(body.toId, '收款人', 100);
            if (toId === current.id || !lookupMembership(workspaceId, toId) || !Number.isSafeInteger(body.amount) || Number(body.amount) <= 0 || Number(body.amount) > 1_000_000_000) throw new HttpError(400, '收款人或金額不正確');
            const result = idempotent(current.id, `settlements:${workspaceId}`, body, () => {
              const id = randomUUID(); db.prepare('INSERT INTO settlement_confirmations(id,workspace_id,from_id,to_id,amount,created_at) VALUES(?,?,?,?,?,?)').run(id, workspaceId, current.id, toId, Number(body.amount), new Date().toISOString());
              return { id, status: 'pending' };
            });
            broadcast(workspaceId, { kind: 'expenses' }); json(201, result); return;
          }
          if (req.method === 'PATCH' && resourceId) {
            const item = db.prepare('SELECT * FROM settlement_confirmations WHERE id=? AND workspace_id=?').get(resourceId, workspaceId) as { to_id: string; status: string } | undefined;
            if (!item) throw new HttpError(404, '找不到結清紀錄');
            if (item.to_id !== current.id) throw new HttpError(403, '只有收款人可以確認收到款項');
            if (body.status !== 'confirmed') throw new HttpError(400, '狀態不正確');
            db.prepare("UPDATE settlement_confirmations SET status='confirmed',confirmed_at=COALESCE(confirmed_at,?) WHERE id=?").run(new Date().toISOString(), resourceId);
            broadcast(workspaceId, { kind: 'expenses' }); json(200, { ok: true }); return;
          }
        }
      }
      const noteRoute = /^\/api\/notes\/([^/]+)(?:\/(attachments))?$/.exec(pathname);
      if (noteRoute) {
        const note = db.prepare('SELECT * FROM notes WHERE id=?').get(noteRoute[1]!) as unknown as NoteRow | undefined;
        if (!note) { requireUser(); throw new HttpError(404, '找不到筆記', 'NOT_FOUND'); }
        requireWorkspace(note.workspace_id, req.method !== 'GET');
        const current = requireUser();
        if (noteRoute[2] === 'attachments') {
          if (req.method === 'GET') { json(200, { attachments: (db.prepare('SELECT * FROM attachments WHERE note_id=? ORDER BY rowid').all(note.id) as unknown as FileRow[]).map(fileJson) }); return; }
          if (req.method === 'POST') {
            const response = idempotent(current.id, `attachments:${note.id}`, body, () => {
              const name = [...string(body.name, '檔案名稱', 200)].map((char) => char.charCodeAt(0) < 32 || char === '/' || char === '\\' ? '_' : char).join('');
              const mime = string(body.mime, '檔案類型', 100).toLowerCase();
              if (!ALLOWED_MIMES.has(mime)) throw new HttpError(415, '僅支援圖片、影片、音訊及 PDF；不接受 SVG/HTML', 'UNSUPPORTED_FILE');
              const encoded = string(body.data, '檔案內容', Math.ceil(MAX_FILE * 4 / 3) + 8);
              if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new HttpError(400, 'Base64 格式不正確');
              const bytes = Buffer.from(encoded, 'base64');
              if (!bytes.length || bytes.length > MAX_FILE) throw new HttpError(413, '附件限制為 20 MB', 'TOO_LARGE');
              if (!validFileBytes(bytes, mime)) throw new HttpError(415, '檔案內容與宣告類型不一致', 'FILE_SIGNATURE');
              const id = randomUUID(); writeFileSync(join(uploadDir, id), bytes, { flag: 'wx', mode: 0o600 });
              try { db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?)').run(id, note.id, name, mime, bytes.length); } catch (error) { unlinkSync(join(uploadDir, id)); throw error; }
              return { attachment: fileJson({ id, note_id: note.id, name, mime, size: bytes.length, workspace_id: note.workspace_id }) };
            });
            broadcast(note.workspace_id, { kind: 'attachments', noteId: note.id }); json(201, response); return;
          }
        } else {
          if (req.method === 'GET') { json(200, { note: noteJson(note) }); return; }
          if (req.method === 'PATCH') {
            if (body.version !== note.version) throw new HttpError(409, '筆記已被其他成員修改，請保留草稿並載入最新版本', 'VERSION_CONFLICT');
            const value = validateNote({ title: note.title, content: note.content, tags: JSON.parse(note.tags), notebookId: note.notebook_id, template: note.template, ...body }, note.workspace_id);
            const result = db.prepare('UPDATE notes SET title=?,content=?,tags=?,notebook_id=?,template=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(value.title, value.content, JSON.stringify(value.tags), value.notebookId, value.template, new Date().toISOString(), note.id, note.version);
            if (Number(result.changes) !== 1) throw new HttpError(409, '筆記版本衝突', 'VERSION_CONFLICT');
            broadcast(note.workspace_id, { kind: 'notes', noteId: note.id }); json(200, { note: noteJson(db.prepare('SELECT * FROM notes WHERE id=?').get(note.id) as unknown as NoteRow) }); return;
          }
          if (req.method === 'DELETE') {
            if (body.version !== note.version) throw new HttpError(409, '筆記已更新，請重新整理後再刪除', 'VERSION_CONFLICT');
            const files = db.prepare('SELECT id FROM attachments WHERE note_id=?').all(note.id) as { id: string }[];
            db.prepare('DELETE FROM notes WHERE id=? AND version=?').run(note.id, note.version);
            for (const file of files) if (existsSync(join(uploadDir, file.id))) unlinkSync(join(uploadDir, file.id));
            broadcast(note.workspace_id, { kind: 'notes', noteId: note.id }); json(200, { ok: true }); return;
          }
        }
      }
      const fileRoute = /^\/api\/(files|attachments)\/([^/]+)$/.exec(pathname);
      if (fileRoute) {
        requireUser();
        const file = db.prepare('SELECT a.*,n.workspace_id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=?').get(fileRoute[2]!) as unknown as FileRow | undefined;
        if (!file) throw new HttpError(404, '找不到附件', 'NOT_FOUND');
        requireWorkspace(file.workspace_id, req.method !== 'GET' && req.method !== 'HEAD');
        const path = join(uploadDir, file.id);
        if (fileRoute[1] === 'files' && ['GET', 'HEAD'].includes(req.method || '')) {
          if (!existsSync(path)) throw new HttpError(404, '附件檔案遺失');
          const bytes = readFileSync(path); const headers = { 'Content-Type': file.mime, 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Accept-Ranges': 'bytes' };
          const range = req.headers.range;
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) throw new HttpError(416, '不支援的範圍');
            const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
            const end = match[1] ? Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1) : bytes.length - 1;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) { res.setHeader('Content-Range', `bytes */${bytes.length}`); throw new HttpError(416, '不支援的範圍'); }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 }); res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1)); return;
          }
          res.writeHead(200, { ...headers, 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
        }
        if (fileRoute[1] === 'attachments' && req.method === 'DELETE') {
          db.prepare('DELETE FROM attachments WHERE id=?').run(file.id); if (existsSync(path)) unlinkSync(path);
          broadcast(file.workspace_id, { kind: 'attachments', noteId: file.note_id }); json(200, { ok: true }); return;
        }
      }
      const expenseRoute = /^\/api\/expenses\/([^/]+)$/.exec(pathname);
      if (expenseRoute && req.method === 'DELETE') {
        requireUser(); const expense = db.prepare('SELECT workspace_id FROM expenses WHERE id=?').get(expenseRoute[1]!) as { workspace_id: string } | undefined;
        if (!expense) throw new HttpError(404, '找不到費用');
        requireWorkspace(expense.workspace_id, true); db.prepare('DELETE FROM expenses WHERE id=?').run(expenseRoute[1]!);
        broadcast(expense.workspace_id, { kind: 'expenses' }); json(200, { ok: true }); return;
      }
      throw new HttpError(404, '找不到 API', 'NOT_FOUND');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) json(error.status, { error: error.message, code: error.code });
      else { console.error('Request failed:', error instanceof Error ? error.message : 'unknown'); json(500, { error: '伺服器處理失敗，請稍後重試', code: 'INTERNAL' }); }
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  function validateNote(body: Record<string, unknown>, workspaceId: string) {
    const title = string(body.title ?? '未命名筆記', '筆記標題', 200).trim();
    const content = string(body.content ?? '', '筆記內容', 512 * 1024, true);
    if (!Array.isArray(body.tags ?? []) || (body.tags as unknown[] | undefined || []).length > 30) throw new HttpError(400, '最多 30 個標籤');
    const tags = [...new Set(((body.tags || []) as unknown[]).map((value) => string(value, '標籤', 40).trim()))];
    const notebookId = body.notebookId ? string(body.notebookId, '筆記本', 100) : null;
    if (notebookId && !db.prepare('SELECT id FROM notebooks WHERE id=? AND workspace_id=?').get(notebookId, workspaceId)) throw new HttpError(400, '筆記本不屬於此工作空間', 'NOTEBOOK_SCOPE');
    return { title, content, tags, notebookId, template: string(body.template || 'blank', '模板', 50) };
  }
  function idempotent(userId: string, scope: string, body: Record<string, unknown>, fn: () => unknown): unknown {
    const key = string(body.clientMutationId, 'clientMutationId', 100);
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return transaction(() => {
      const existing = db.prepare('SELECT request_hash,response FROM mutations WHERE user_id=? AND scope=? AND key=?').get(userId, scope, key) as { request_hash: string; response: string } | undefined;
      if (existing) { if (existing.request_hash !== hash) throw new HttpError(409, '重複操作識別碼已用於不同內容', 'IDEMPOTENCY_CONFLICT'); return JSON.parse(existing.response) as unknown; }
      const response = fn(); db.prepare('INSERT INTO mutations VALUES(?,?,?,?,?)').run(userId, scope, key, hash, JSON.stringify(response)); return response;
    });
  }
  function expenseSummary(workspaceId: string) {
    const rows = db.prepare('SELECT * FROM expenses WHERE workspace_id=? ORDER BY created_at DESC,id').all(workspaceId) as unknown as ExpenseRow[];
    const balance = new Map<string, number>();
    for (const row of rows) {
      const people = JSON.parse(row.participant_ids) as string[];
      balance.set(row.payer_id, (balance.get(row.payer_id) || 0) + row.amount);
      const perPerson = Math.floor(row.amount / people.length); const remainder = row.amount % people.length;
      people.forEach((id, index) => balance.set(id, (balance.get(id) || 0) - perPerson - (index < remainder ? 1 : 0)));
    }
    const confirmations = db.prepare("SELECT from_id,to_id,amount FROM settlement_confirmations WHERE workspace_id=? AND status='confirmed'").all(workspaceId) as { from_id: string; to_id: string; amount: number }[];
    for (const item of confirmations) { balance.set(item.from_id, (balance.get(item.from_id) || 0) + item.amount); balance.set(item.to_id, (balance.get(item.to_id) || 0) - item.amount); }
    for (const member of db.prepare('SELECT user_id FROM members WHERE workspace_id=?').all(workspaceId) as { user_id: string }[]) if (!balance.has(member.user_id)) balance.set(member.user_id, 0);
    const balances = [...balance].sort(([a], [b]) => a.localeCompare(b)).map(([userId, amount]) => ({ userId, name: getUser(userId)?.name || '已移除的成員', balance: amount }));
    const creditors = balances.filter((b) => b.balance > 0).map((b) => ({ ...b }));
    const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ ...b }));
    const settlements: { from: string; to: string; amount: number }[] = [];
    let c = 0; let d = 0;
    while (c < creditors.length && d < debtors.length) {
      const creditor = creditors[c]!; const debtor = debtors[d]!; const amount = Math.min(creditor.balance, -debtor.balance);
      settlements.push({ from: debtor.userId, to: creditor.userId, amount }); creditor.balance -= amount; debtor.balance += amount;
      if (creditor.balance === 0) c++; if (debtor.balance === 0) d++;
    }
    return { expenses: rows.map((row) => ({ id: row.id, description: row.description, amount: row.amount, payerId: row.payer_id, participantIds: JSON.parse(row.participant_ids) as string[], createdAt: row.created_at })), balances, settlements, currency: 'TWD' };
  }
  return { server, db, dataDir, close: async () => { for (const stream of streams) closeStream(stream); await new Promise<void>((done) => { if (server.listening) { server.close(() => done()); server.closeIdleConnections(); } else done(); }); db.close(); } };
}
