import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  ProviderError, createCalendarEvent, generateText, isQuietHour, pushLine,
  refreshGoogleToken, sendGmail, transcribeAudio, uploadDriveFile,
  type Fetcher, type ProviderConfig, type WorkspaceBinding,
} from '../server/providers.js';

const config: ProviderConfig = {
  googleClientId: 'test-client', googleClientSecret: 'test-client-secret',
  openaiApiKey: 'test-not-a-real-key', openaiModel: 'test-model', lineChannelAccessToken: 'test-line-token',
};
const binding: WorkspaceBinding = {
  googleRefreshToken: 'test-refresh', driveFolderId: 'test-folder', calendarId: 'group@example.com',
  lineRecipientId: `C${'1'.repeat(32)}`, gmailFrom: 'group@example.com',
};

type Call = { url: string; options: RequestInit };
function mock(responses: Array<{ status?: number; data?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (input, options = {}) => {
    calls.push({ url: String(input), options });
    const next = responses.shift();
    assert.ok(next, 'unexpected extra external call');
    return new Response(JSON.stringify(next.data ?? {}), {
      status: next.status ?? 200, headers: { 'Content-Type': 'application/json', ...next.headers },
    });
  };
  return { fetcher, calls };
}

const tokenResponse = () => ({ data: { access_token: 'test-access-token' } });
function isCode(code: string, uncertain?: boolean) {
  return (error: unknown): boolean => error instanceof ProviderError && error.code === code
    && (uncertain === undefined || error.uncertain === uncertain);
}

test('missing credentials fail locally without external requests', async () => {
  const { fetcher, calls } = mock([]);
  await assert.rejects(refreshGoogleToken({}, {}, fetcher), isCode('NOT_CONFIGURED'));
  await assert.rejects(generateText({}, { instruction: 'translate', text: 'hi', maxOutputTokens: 128 }, fetcher), isCode('NOT_CONFIGURED'));
  await assert.rejects(pushLine({}, {}, { text: 'hi', idempotencyKey: 'test-request-1' }, fetcher), isCode('NOT_CONFIGURED'));
  assert.equal(calls.length, 0);
});

test('Google refresh sends confidential values only to fixed token endpoint', async () => {
  const { fetcher, calls } = mock([tokenResponse()]);
  assert.equal(await refreshGoogleToken(config, binding, fetcher), 'test-access-token');
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0]!.options.redirect, 'error');
  assert.ok(calls[0]!.options.signal instanceof AbortSignal);
  const form = calls[0]!.options.body as URLSearchParams;
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'test-refresh');
});

test('Drive multipart retains binary bytes and explicit folder binding', async () => {
  const { fetcher, calls } = mock([tokenResponse(), { data: { id: 'file-1', name: 'photo.png' } }]);
  assert.deepEqual(await uploadDriveFile(config, binding, { name: 'photo.png', mime: 'image/png', data: Buffer.from([0, 255, 1]) }, fetcher), { id: 'file-1', name: 'photo.png' });
  const request = calls[1]!;
  assert.match(request.url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/);
  assert.match(request.url, /supportsAllDrives=true/);
  const body = Buffer.from(request.options.body as Uint8Array);
  assert.ok(body.includes(Buffer.from([0, 255, 1])));
  assert.ok(body.includes(Buffer.from('"parents":["test-folder"]')));
});

test('Drive rejects oversized and active content before token exchange', async () => {
  const { fetcher, calls } = mock([]);
  await assert.rejects(uploadDriveFile(config, binding, { name: 'x.svg', mime: 'image/svg+xml', data: Buffer.from('<svg/>') }, fetcher), isCode('INVALID_FILE'));
  await assert.rejects(uploadDriveFile(config, binding, { name: 'x.png', mime: 'image/png', data: Buffer.alloc(5 * 1024 * 1024 + 1) }, fetcher), isCode('INVALID_FILE'));
  assert.equal(calls.length, 0);
});

test('Calendar derives stable event id and sends no attendee emails', async () => {
  const { fetcher, calls } = mock([tokenResponse(), { data: { id: 'event-1' } }]);
  await createCalendarEvent(config, binding, {
    summary: '旅行', description: '確認後建立', start: '2026-10-28T09:00:00+08:00',
    end: '2026-10-28T10:00:00+08:00', timeZone: 'Asia/Taipei', idempotencyKey: 'calendar-request-1',
  }, fetcher);
  assert.ok(calls[1]!.url.includes('group%40example.com'));
  assert.ok(calls[1]!.url.endsWith('?sendUpdates=none'));
  const payload = JSON.parse(calls[1]!.options.body as string) as Record<string, unknown>;
  assert.equal(payload.id, createHash('sha256').update('calendar-request-1').digest('hex'));
  assert.equal(payload.attendees, undefined);
});

test('Calendar rejects reversed and timezone-less date ranges', async () => {
  const { fetcher, calls } = mock([]);
  await assert.rejects(createCalendarEvent(config, binding, {
    summary: 'trip', description: '', start: '2026-10-28T09:00:00', end: '2026-10-28T08:00:00',
    timeZone: 'Asia/Taipei', idempotencyKey: 'calendar-request-1',
  }, fetcher), isCode('INVALID_INPUT'));
  assert.equal(calls.length, 0);
});

test('Gmail encodes MIME and rejects CRLF header injection', async () => {
  const { fetcher, calls } = mock([tokenResponse(), { data: { id: 'message-1' } }]);
  await sendGmail(config, binding, { to: 'friend@example.com', subject: '行程安排', text: '內容\r\n二行' }, fetcher);
  const body = JSON.parse(calls[1]!.options.body as string) as { raw: string };
  const raw = Buffer.from(body.raw, 'base64url').toString();
  assert.ok(raw.includes('To: friend@example.com\r\n'));
  assert.ok(raw.includes('Subject: =?UTF-8?B?'));
  assert.ok(raw.includes(Buffer.from('內容\r\n二行').toString('base64')));
  const noCalls = mock([]);
  await assert.rejects(sendGmail(config, binding, { to: 'friend@example.com\r\nBcc:other@example.com', subject: 'x', text: 'x' }, noCalls.fetcher), isCode('INVALID_INPUT'));
  await assert.rejects(sendGmail(config, binding, { to: 'friend@example.com', subject: 'x\nBcc:x', text: 'x' }, noCalls.fetcher), isCode('INVALID_INPUT'));
  assert.equal(noCalls.calls.length, 0);
});

test('quiet hours cross midnight and respect workspace timezone', () => {
  const quiet = { quietHours: { start: 22, end: 8, timeZone: 'Asia/Taipei' } };
  assert.equal(isQuietHour(quiet, new Date('2026-10-27T15:00:00Z')), true);
  assert.equal(isQuietHour(quiet, new Date('2026-10-28T01:00:00Z')), false);
  assert.equal(isQuietHour({ quietHours: { start: 8, end: 8, timeZone: 'UTC' } }), false);
  assert.throws(() => isQuietHour({ quietHours: { start: -1, end: 8, timeZone: 'UTC' } }), isCode('INVALID_CONFIGURATION'));
});

test('LINE uses bound recipient and deterministic valid retry UUID', async () => {
  const { fetcher, calls } = mock([{ data: {}, headers: { 'x-line-request-id': 'line-1' } }, { data: {} }]);
  assert.deepEqual(await pushLine(config, binding, { text: '已確認的群組訊息', idempotencyKey: 'line-request-1' }, fetcher), { requestId: 'line-1' });
  await pushLine(config, binding, { text: '已確認的群組訊息', idempotencyKey: 'line-request-1' }, fetcher);
  const first = new Headers(calls[0]!.options.headers).get('x-line-retry-key');
  assert.match(first!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first, new Headers(calls[1]!.options.headers).get('x-line-retry-key'));
  assert.equal((JSON.parse(calls[0]!.options.body as string) as { to: string }).to, binding.lineRecipientId);
});

test('OpenAI sends bounded text with store:false and parses output blocks', async () => {
  const { fetcher, calls } = mock([{ data: { output: [{ type: 'message', content: [{ type: 'output_text', text: '旅遊' }] }], usage: { input_tokens: 20, output_tokens: 3 } } }]);
  assert.deepEqual(await generateText(config, { instruction: 'Classify selected text only', text: '買伴手禮', maxOutputTokens: 128 }, fetcher), { text: '旅遊', inputTokens: 20, outputTokens: 3 });
  const payload = JSON.parse(calls[0]!.options.body as string) as Record<string, unknown>;
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 128);
  assert.equal(payload.input, '買伴手禮');
  assert.equal(payload.tools, undefined);
  const noCalls = mock([]);
  await assert.rejects(generateText(config, { instruction: 'x', text: 'x', maxOutputTokens: 99999 }, noCalls.fetcher), isCode('INVALID_INPUT'));
  assert.equal(noCalls.calls.length, 0);
});

test('STT builds multipart request only for explicitly supplied supported audio', async () => {
  const { fetcher, calls } = mock([{ data: { text: '測試語音' } }]);
  assert.deepEqual(await transcribeAudio(config, { name: 'clip.wav', mime: 'audio/wav', data: Buffer.from('RIFF-test') }, fetcher), { text: '測試語音' });
  const form = calls[0]!.options.body as FormData;
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.ok(form.get('file') instanceof Blob);
  assert.equal(new Headers(calls[0]!.options.headers).has('Content-Type'), false);
  const noCalls = mock([]);
  await assert.rejects(transcribeAudio(config, { name: 'x.html', mime: 'text/html', data: Buffer.from('x') }, noCalls.fetcher), isCode('INVALID_FILE'));
  assert.equal(noCalls.calls.length, 0);
});

test('provider errors never reflect secrets and uncertain writes stay uncertain', async () => {
  const { fetcher } = mock([{ status: 500, data: { error: 'secret-token-and-private-content' } }]);
  await assert.rejects(generateText(config, { instruction: 'x', text: 'private note', maxOutputTokens: 128 }, fetcher), error => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.uncertain, true);
    assert.ok(!error.message.includes('secret-token'));
    assert.ok(!error.message.includes('private note'));
    return true;
  });
  const networkFailure: Fetcher = async () => { throw new Error('secret-token-network'); };
  await assert.rejects(pushLine(config, binding, { text: 'hi', idempotencyKey: 'line-request-2' }, networkFailure), isCode('UPSTREAM_UNAVAILABLE', true));
  const invalid = mock([tokenResponse(), { data: {} }]);
  await assert.rejects(sendGmail(config, binding, { to: 'friend@example.com', subject: 'x', text: 'x' }, invalid.fetcher), isCode('INVALID_UPSTREAM_RESPONSE', true));
});
