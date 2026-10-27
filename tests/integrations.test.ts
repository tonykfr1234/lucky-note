import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { handleIntegrationRoutes } from '../server/integrations.js';
import { HttpError, type IntegrationContext, type Membership, type User } from '../server/types.js';

type Json = Record<string, unknown>;
const user: User = { id: 'user-a', name: 'Alice', email: 'alice@example.invalid', avatar: '' };

function fixture(t: TestContext, env: NodeJS.ProcessEnv = {}, role: Membership['role'] = 'owner', type: Membership['type'] = 'group') {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE notes(id TEXT PRIMARY KEY,workspace_id TEXT,title TEXT,tags TEXT,notebook_id TEXT,created_at TEXT,updated_at TEXT,version INTEGER);
    CREATE TABLE notebooks(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT);
    INSERT INTO notes VALUES('note-a','space-a','旅行購物','["旅行"]',NULL,'2026-10-26T17:00:00.000Z','2026-10-26T17:00:00.000Z',1);
    INSERT INTO notes VALUES('note-old','space-a','舊筆記','[]',NULL,'2026-10-20T10:00:00.000Z','2026-10-20T10:00:00.000Z',1);
    INSERT INTO notes VALUES('note-b','space-b','別組私人內容','[]',NULL,'2026-10-27T10:00:00.000Z','2026-10-27T10:00:00.000Z',1);
    INSERT INTO notebooks VALUES('book-a','space-a','旅行');
    INSERT INTO notebooks VALUES('book-b','space-b','私密');`);
  t.after(() => db.close());
  let signedIn = 0;
  async function call(method: string, path: string, body: Json = {}, cookie = '', activeUser: User | null = user) {
    const headers = new Map<string, unknown>(); let status = 0; let response: unknown; let redirected = false;
    const res = { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: unknown) => { headers.set(key, value); }, writeHead: (code: number, values: Record<string, unknown>) => { status = code; Object.entries(values).forEach(([key, value]) => headers.set(key, value)); }, end: () => { redirected = true; } } as unknown as ServerResponse;
    const ctx: IntegrationContext = {
      req: { method, headers: { cookie } } as IncomingMessage, res, url: new URL(path, 'http://localhost:4317'), body, db, user: activeUser, env,
      json: (code, payload) => { status = code; response = payload; },
      requireUser: () => { if (!activeUser) throw new HttpError(401, '登入'); return activeUser; },
      requireWorkspace: (id, write = false) => { if (!activeUser) throw new HttpError(401, '登入'); if (id !== 'space-a' || (write && role === 'viewer')) throw new HttpError(403, '禁止'); return { id, workspaceId: id, userId: user.id, role, type, name: 'A' }; },
      createGoogleSession: profile => { assert.equal(profile.emailVerified, true); signedIn += 1; return user; },
      readAttachment: () => { throw new HttpError(404, '附件不存在'); },
      broadcast: () => undefined,
    };
    const handled = await handleIntegrationRoutes(ctx);
    return { handled, status, data: response as Json, headers, redirected };
  }
  return { db, call, signedIn: () => signedIn };
}

async function expectStatus(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, error => error instanceof HttpError && error.status === status && (!code || error.code === code));
}

test('integration status requires authentication and never exposes server secrets', async t => {
  const f = fixture(t, { OPENAI_API_KEY: 'not-a-real-secret' });
  await expectStatus(f.call('GET', '/api/integrations', {}, '', null), 401);
  await expectStatus(f.call('GET', '/api/integrations?workspaceId=space-b'), 403);
  const result = await f.call('GET', '/api/integrations?workspaceId=space-a');
  assert.equal(result.status, 200);
  assert.ok(!JSON.stringify(result.data).includes('not-a-real-secret'));
  const entries = result.data.integrations as Array<{ id: string; configured: boolean }>;
  assert.equal(entries.find(entry => entry.id === 'openai')?.configured, true);
  assert.equal(entries.find(entry => entry.id === 'line')?.configured, false);
  assert.equal(entries.find(entry => entry.id === 'stt')?.configured, false);
});

test('private workspaces and non-owners cannot export through provider routes', async t => {
  const privateSpace = fixture(t, {}, 'owner', 'private'); const editor = fixture(t, {}, 'editor');
  await expectStatus(privateSpace.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'private' }), 403, 'GROUP_OWNER_REQUIRED');
  await expectStatus(editor.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'text' }), 403, 'GROUP_OWNER_REQUIRED');
});

test('external preview does not send; missing confirmation and credentials fail honestly', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not call'); });
  const f = fixture(t); const preview = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'hello' });
  const id = (preview.data.preview as Json).id;
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: id, clientMutationId: 'request-1234' }), 400, 'CONFIRMATION_REQUIRED');
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: id, confirmed: true, clientMutationId: 'request-1234' }), 503, 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('external confirmation is idempotent and rejects reuse of the mutation key for changed content', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 200, headers: { 'x-line-request-id': 'fake-only' } }); });
  const f = fixture(t, { LINE_CHANNEL_ACCESS_TOKEN: 'test-token', WORKSPACE_INTEGRATIONS_JSON: JSON.stringify({ 'space-a': { lineRecipientId: `C${'a'.repeat(32)}` } }) });
  const preview = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'hello' }); const id = (preview.data.preview as Json).id;
  const data = { previewId: id, confirmed: true, clientMutationId: 'request-1234' };
  assert.equal((await f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', data)).data.status, 'sent');
  assert.equal((await f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', data)).data.duplicate, true);
  const changed = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'changed' });
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { ...data, previewId: (changed.data.preview as Json).id }), 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal(calls, 1);
});

test('uncertain external outcome blocks all automatic retries including a fresh matching preview', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('timeout after upstream write'); });
  const f = fixture(t, { LINE_CHANNEL_ACCESS_TOKEN: 'test-token', WORKSPACE_INTEGRATIONS_JSON: JSON.stringify({ 'space-a': { lineRecipientId: `C${'a'.repeat(32)}` } }) });
  const first = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'hello' }); const id = (first.data.preview as Json).id;
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: id, confirmed: true, clientMutationId: 'request-1234' }), 502);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: id, confirmed: true, clientMutationId: 'request-1234' }), 409);
  const next = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'hello' });
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: (next.data.preview as Json).id, confirmed: true, clientMutationId: 'request-5678' }), 409, 'UNCERTAIN_PREVIOUS_RESULT');
  assert.equal(calls, 1);
});

test('external confirmation rechecks current provider binding against the preview', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not send'); });
  const env = { LINE_CHANNEL_ACCESS_TOKEN: 'test-token', WORKSPACE_INTEGRATIONS_JSON: JSON.stringify({ 'space-a': { lineRecipientId: `C${'a'.repeat(32)}` } }) };
  const f = fixture(t, env); const first = await f.call('POST', '/api/workspaces/space-a/integrations/line/preview', { text: 'hello' });
  env.WORKSPACE_INTEGRATIONS_JSON = JSON.stringify({ 'space-a': { lineRecipientId: `C${'b'.repeat(32)}` } });
  await expectStatus(f.call('POST', '/api/workspaces/space-a/integrations/line/confirm', { previewId: (first.data.preview as Json).id, confirmed: true, clientMutationId: 'request-1234' }), 409, 'BINDING_CHANGED');
  assert.equal(calls, 0);
});

const previewBody = { noteIds: ['note-a', 'note-old'], fromDate: '2026-10-27', timeZone: 'Asia/Taipei', maxOutputTokens: 512, tokenBudget: 8000 };
test('AI previews explicit metadata only, respects cutoff timezone, and blocks empty/foreign/duplicate selections', async t => {
  const f = fixture(t);
  const response = await f.call('POST', '/api/workspaces/space-a/ai/preview', previewBody); const preview = response.data.preview as Json;
  assert.equal(preview.source, 'selected-note-metadata'); assert.equal(preview.excludedCount, 1); assert.equal((preview.items as unknown[]).length, 1);
  assert.ok(!(preview.inputText as string).includes('別組私人內容')); assert.equal(response.data.configured, false);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, noteIds: [] }), 400);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, noteIds: ['note-b'] }), 404);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, noteIds: ['note-a', 'note-a'] }), 400);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, fromDate: '2026-99-99' }), 400);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, timeZone: 'invalid/zone' }), 400);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/preview', { ...previewBody, tokenBudget: 256 }), 400, 'BUDGET_EXCEEDED');
});

test('AI missing credentials never calls provider or consumes budget', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error(); });
  const f = fixture(t); const response = await f.call('POST', '/api/workspaces/space-a/ai/preview', previewBody); const previewId = (response.data.preview as Json).id;
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId, confirmed: true }), 503, 'NOT_CONFIGURED');
  assert.equal(calls, 0); assert.equal(f.db.prepare('SELECT count(*) as n FROM ai_budget').get()?.n, 0);
});

test('AI suggestion requires a second explicit classification; repeated calls do not double charge or apply', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls++; const request = JSON.parse(String(init.body)); assert.equal(request.store, false); assert.equal(request.max_output_tokens, 512); return Response.json({ output_text: '建議放入旅行。', usage: { input_tokens: 20, output_tokens: 10 } }); });
  const f = fixture(t, { OPENAI_API_KEY: 'test-key' }); const response = await f.call('POST', '/api/workspaces/space-a/ai/preview', previewBody); const previewId = (response.data.preview as Json).id;
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId }), 400, 'CONFIRMATION_REQUIRED');
  await f.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId, confirmed: true });
  assert.equal((await f.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId, confirmed: true })).data.duplicate, true);
  assert.equal(f.db.prepare("SELECT notebook_id FROM notes WHERE id='note-a'").get()?.notebook_id, null);
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/confirm', { previewId, confirmed: true, assignments: [{ noteId: 'note-a', notebookId: 'book-b' }] }), 404);
  const assignment = { previewId, confirmed: true, assignments: [{ noteId: 'note-a', notebookId: 'book-a' }] };
  assert.equal((await f.call('POST', '/api/workspaces/space-a/ai/confirm', assignment)).data.applied, 1);
  assert.equal((await f.call('POST', '/api/workspaces/space-a/ai/confirm', assignment)).data.duplicate, true);
  assert.equal(f.db.prepare("SELECT version FROM notes WHERE id='note-a'").get()?.version, 2); assert.equal(calls, 1);
});

test('AI stale preview cannot overwrite a concurrently edited note and daily budget is enforced', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ output_text: '建議' }));
  const f = fixture(t, { OPENAI_API_KEY: 'test-key' }); const preview = await f.call('POST', '/api/workspaces/space-a/ai/preview', previewBody); const previewId = (preview.data.preview as Json).id;
  await f.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId, confirmed: true }); f.db.prepare("UPDATE notes SET version=2 WHERE id='note-a'").run();
  await expectStatus(f.call('POST', '/api/workspaces/space-a/ai/confirm', { previewId, confirmed: true, assignments: [{ noteId: 'note-a', notebookId: 'book-a' }] }), 409, 'VERSION_CONFLICT');
  const limited = fixture(t, { OPENAI_API_KEY: 'test-key', OPENAI_DAILY_TOKEN_LIMIT: '1' }); const p = await limited.call('POST', '/api/workspaces/space-a/ai/preview', previewBody);
  await expectStatus(limited.call('POST', '/api/workspaces/space-a/ai/suggest', { previewId: (p.data.preview as Json).id, confirmed: true }), 429, 'DAILY_BUDGET_EXCEEDED');
});

test('translation idempotency is user scoped and a second member cannot receive another user result', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ output_text: `translated-${calls}` }); });
  const f = fixture(t, { OPENAI_API_KEY: 'test-key' }); const body = { text: '選取的文字', targetLanguage: 'English', confirmed: true, clientMutationId: 'shared-request-key', tokenBudget: 8000, maxOutputTokens: 512 };
  const first = await f.call('POST', '/api/workspaces/space-a/tools/translate', body);
  const secondUser = { ...user, id: 'user-b' };
  const second = await f.call('POST', '/api/workspaces/space-a/tools/translate', body, '', secondUser);
  assert.equal(first.data.text, 'translated-1'); assert.equal(second.data.text, 'translated-2'); assert.equal(calls, 2);
});

test('Google OAuth is explicitly unavailable without configuration', async t => {
  await expectStatus(fixture(t).call('GET', '/api/auth/google'), 503, 'NOT_CONFIGURED');
});

test('Google OAuth starts with PKCE and limited scopes; cancellation consumes one-time state', async t => {
  const f = fixture(t, { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', APP_ORIGIN: 'http://localhost:4317' });
  const start = await f.call('GET', '/api/auth/google'); const redirect = new URL(String(start.headers.get('Location'))); const state = redirect.searchParams.get('state');
  assert.equal(redirect.origin, 'https://accounts.google.com'); assert.equal(redirect.searchParams.get('scope'), 'openid email profile'); assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(String(start.headers.get('Set-Cookie')).includes('HttpOnly'));
  const cancellation = await f.call('GET', `/api/auth/google/callback?error=access_denied&state=${state}`, {}, `ln_oauth=${state}`);
  assert.equal(cancellation.status, 302); assert.equal(cancellation.headers.get('Location'), '/?auth=cancelled'); assert.equal(f.signedIn(), 0);
  await expectStatus(f.call('GET', `/api/auth/google/callback?code=fake&state=${state}`, {}, `ln_oauth=${state}`), 400, 'INVALID_OAUTH_STATE');
});

test('Google OIDC verifies signature audience nonce and matching userinfo using mocked official endpoints', async t => {
  const f = fixture(t, { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', APP_ORIGIN: 'http://localhost:4317' });
  const start = await f.call('GET', '/api/auth/google'); const redirect = new URL(String(start.headers.get('Location'))); const state = redirect.searchParams.get('state'); const nonce = redirect.searchParams.get('nonce');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = publicKey.export({ format: 'jwk' });
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ aud: 'client', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), nonce, sub: 'google-subject', email_verified: true })).toString('base64url');
  const token = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests++;
    if (url === 'https://oauth2.googleapis.com/token') { assert.ok(String(init.body).includes('code_verifier=')); return Response.json({ access_token: 'test-access', id_token: token }); }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: 'google-subject', email: 'alice@example.invalid', name: 'Alice', email_verified: true });
    throw new Error('unexpected endpoint');
  });
  const callback = await f.call('GET', `/api/auth/google/callback?code=fake&state=${state}`, {}, `ln_oauth=${state}`);
  assert.equal(callback.status, 302); assert.equal(f.signedIn(), 1); assert.equal(requests, 3);
});

test('Google OIDC rejects tampered signature, wrong audience/issuer/nonce, expired tokens and mismatched userinfo', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = publicKey.export({ format: 'jwk' });
  for (const failure of ['signature', 'audience', 'issuer', 'nonce', 'expiry', 'userinfo']) {
    await t.test(failure, async subtest => {
      const f = fixture(subtest, { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', APP_ORIGIN: 'http://localhost:4317' });
      const start = await f.call('GET', '/api/auth/google'); const redirect = new URL(String(start.headers.get('Location'))); const state = redirect.searchParams.get('state'); const nonce = redirect.searchParams.get('nonce');
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ aud: failure === 'audience' ? 'wrong-client' : 'client', iss: failure === 'issuer' ? 'https://attacker.invalid' : 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + (failure === 'expiry' ? -600 : 600), iat: Math.floor(Date.now() / 1000), nonce: failure === 'nonce' ? 'wrong-nonce' : nonce, sub: 'google-subject', email_verified: true })).toString('base64url');
      const signature = failure === 'signature' ? Buffer.alloc(256).toString('base64url') : sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
      subtest.mock.method(globalThis, 'fetch', async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access', id_token: `${header}.${claims}.${signature}` });
        if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] });
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: failure === 'userinfo' ? 'other-subject' : 'google-subject', email: 'alice@example.invalid', email_verified: true });
        throw new Error('unexpected endpoint');
      });
      await expectStatus(f.call('GET', `/api/auth/google/callback?code=fake&state=${state}`, {}, `ln_oauth=${state}`), 401);
      assert.equal(f.signedIn(), 0);
    });
  }
});
