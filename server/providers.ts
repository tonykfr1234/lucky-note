import { createHash, randomUUID } from 'node:crypto';

/** Credentials stay on the server. Never serialize these objects to a client. */
export interface ProviderConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTranscriptionModel?: string;
  lineChannelAccessToken?: string;
}

export interface WorkspaceBinding {
  googleRefreshToken?: string;
  driveFolderId?: string;
  calendarId?: string;
  lineRecipientId?: string;
  gmailFrom?: string;
  quietHours?: { start: number; end: number; timeZone: string };
}

export type Fetcher = typeof fetch;

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly uncertain = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

type JsonObject = Record<string, unknown>;

function requireValues(...values: Array<string | undefined>): void {
  if (values.some(value => !value?.trim())) {
    throw new ProviderError('NOT_CONFIGURED', 503, '此服務尚未設定伺服器憑證或工作空間綁定。');
  }
}

function string(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max || value.includes('\0')) {
    throw new ProviderError('INVALID_INPUT', 400, `${label}格式或長度無效。`);
  }
  return value;
}

function object(value: unknown, uncertain = false): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError('INVALID_UPSTREAM_RESPONSE', 502, '服務回傳無效資料。', uncertain);
  }
  return value as JsonObject;
}

function responseString(value: unknown, uncertain = false): string {
  if (typeof value !== 'string' || !value || value.length > 100_000) {
    throw new ProviderError('INVALID_UPSTREAM_RESPONSE', 502, '服務回傳無效資料。', uncertain);
  }
  return value;
}

async function request(
  url: string,
  options: RequestInit,
  fetcher: Fetcher,
  mutation = false,
): Promise<{ data: JsonObject; headers: Headers }> {
  try {
    const response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Never reflect an upstream response body, access token or request payload.
      // A 5xx after a write can have an uncertain outcome; do not blindly retry.
      const code = response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_REJECTED';
      throw new ProviderError(code, response.status === 429 ? 429 : 502,
        '外部服務未完成請求，請檢查設定或稍後再試。', mutation && response.status >= 500);
    }
    let parsed: unknown;
    try { parsed = await response.json(); }
    catch { throw new ProviderError('INVALID_UPSTREAM_RESPONSE', 502, '服務回傳無效資料。', mutation); }
    return { data: object(parsed, mutation), headers: response.headers };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('UPSTREAM_UNAVAILABLE', 502, '無法確認外部服務的回應，請勿重複提交。', mutation);
  }
}

export async function refreshGoogleToken(
  config: ProviderConfig,
  binding: WorkspaceBinding,
  fetcher: Fetcher = fetch,
): Promise<string> {
  requireValues(config.googleClientId, config.googleClientSecret, binding.googleRefreshToken);
  const { data } = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId!, client_secret: config.googleClientSecret!,
      refresh_token: binding.googleRefreshToken!, grant_type: 'refresh_token',
    }),
  }, fetcher);
  return responseString(data.access_token);
}

const attachmentTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
  'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'application/pdf',
]);

function fileInput(file: { name: string; mime: string; data: Buffer }, maxBytes: number): void {
  string(file.name, '檔案名稱', 180);
  if (/[\r\n]/.test(file.name) || !Buffer.isBuffer(file.data) || file.data.length === 0 || file.data.length > maxBytes) {
    throw new ProviderError('INVALID_FILE', 400, '檔案名稱或大小無效。');
  }
}

/** Multipart upload is deliberately limited to 5 MiB; larger files require a resumable adapter. */
export async function uploadDriveFile(
  config: ProviderConfig,
  binding: WorkspaceBinding,
  file: { name: string; mime: string; data: Buffer },
  fetcher: Fetcher = fetch,
): Promise<{ id: string; name: string; webViewLink?: string }> {
  requireValues(binding.driveFolderId);
  fileInput(file, 5 * 1024 * 1024);
  if (!attachmentTypes.has(file.mime)) throw new ProviderError('INVALID_FILE', 400, '不支援此附件類型。');
  const token = await refreshGoogleToken(config, binding, fetcher);
  const boundary = `luckynote_${randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [binding.driveFolderId] });
  const content = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const { data } = await request(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(content) },
    fetcher, true,
  );
  return { id: responseString(data.id, true), name: responseString(data.name, true), ...(typeof data.webViewLink === 'string' ? { webViewLink: data.webViewLink } : {}) };
}

function timeZone(value: string): void {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); }
  catch { throw new ProviderError('INVALID_INPUT', 400, '時區無效。'); }
}

function mutationKey(value: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || !/^[\w-]+$/.test(value)) {
    throw new ProviderError('INVALID_INPUT', 400, '操作識別碼無效。');
  }
  return value;
}

export async function createCalendarEvent(
  config: ProviderConfig,
  binding: WorkspaceBinding,
  event: { summary: string; description: string; start: string; end: string; timeZone: string; idempotencyKey: string },
  fetcher: Fetcher = fetch,
): Promise<{ id: string; htmlLink?: string }> {
  requireValues(binding.calendarId);
  string(event.summary, '行程標題', 300);
  string(event.description, '行程內容', 10_000, true);
  timeZone(event.timeZone);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!dateTime.test(event.start) || !dateTime.test(event.end)
      || !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end))
      || Date.parse(event.start) >= Date.parse(event.end)) {
    throw new ProviderError('INVALID_INPUT', 400, '行程起訖時間必須有效且含時區偏移。');
  }
  const id = createHash('sha256').update(mutationKey(event.idempotencyKey)).digest('hex');
  const token = await refreshGoogleToken(config, binding, fetcher);
  const { data } = await request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(binding.calendarId!)}/events?sendUpdates=none`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, summary: event.summary, description: event.description,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone } }),
  }, fetcher, true);
  return { id: responseString(data.id, true), ...(typeof data.htmlLink === 'string' ? { htmlLink: data.htmlLink } : {}) };
}

function email(value: string): string {
  string(value, '電子郵件', 254);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)) {
    throw new ProviderError('INVALID_INPUT', 400, '電子郵件格式無效。');
  }
  return value;
}

export async function sendGmail(
  config: ProviderConfig,
  binding: WorkspaceBinding,
  message: { to: string; subject: string; text: string },
  fetcher: Fetcher = fetch,
): Promise<{ id: string }> {
  requireValues(binding.gmailFrom);
  const to = email(message.to);
  const from = email(binding.gmailFrom!);
  string(message.subject, '郵件主旨', 300);
  string(message.text, '郵件內容', 30_000);
  if (/[\r\n]/.test(message.subject)) throw new ProviderError('INVALID_INPUT', 400, '郵件主旨不可含換行。');
  const subjectPoints = Array.from(message.subject);
  const subjectWords: string[] = [];
  for (let offset = 0; offset < subjectPoints.length; offset += 12) {
    subjectWords.push(`=?UTF-8?B?${Buffer.from(subjectPoints.slice(offset, offset + 12).join('')).toString('base64')}?=`);
  }
  const subject = subjectWords.join('\r\n ');
  const text = Buffer.from(message.text).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const raw = Buffer.from([
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', text,
  ].join('\r\n')).toString('base64url');
  const token = await refreshGoogleToken(config, binding, fetcher);
  const { data } = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  }, fetcher, true);
  return { id: responseString(data.id, true) };
}

export function isQuietHour(binding: WorkspaceBinding, now = new Date()): boolean {
  const quiet = binding.quietHours;
  if (!quiet) return false;
  if (!Number.isInteger(quiet.start) || !Number.isInteger(quiet.end) || quiet.start < 0 || quiet.end < 0 || quiet.start > 23 || quiet.end > 23) {
    throw new ProviderError('INVALID_CONFIGURATION', 503, '通知安靜時段設定無效。');
  }
  timeZone(quiet.timeZone);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: quiet.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (quiet.start === quiet.end) return false;
  return quiet.start < quiet.end ? hour >= quiet.start && hour < quiet.end : hour >= quiet.start || hour < quiet.end;
}

export async function pushLine(
  config: ProviderConfig,
  binding: WorkspaceBinding,
  message: { text: string; idempotencyKey: string },
  fetcher: Fetcher = fetch,
): Promise<{ requestId?: string }> {
  requireValues(config.lineChannelAccessToken, binding.lineRecipientId);
  string(message.text, 'LINE 訊息', 5_000);
  if (!/^[UCR][0-9a-f]{32}$/i.test(binding.lineRecipientId!)) throw new ProviderError('INVALID_CONFIGURATION', 503, 'LINE 收件人綁定無效。');
  if (isQuietHour(binding)) throw new ProviderError('QUIET_HOURS', 409, '目前為安靜時段，訊息尚未傳送。');
  const hex = createHash('sha256').update(mutationKey(message.idempotencyKey)).digest('hex');
  const key = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const { headers } = await request('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { Authorization: `Bearer ${config.lineChannelAccessToken!}`, 'Content-Type': 'application/json', 'X-Line-Retry-Key': key },
    body: JSON.stringify({ to: binding.lineRecipientId, messages: [{ type: 'text', text: message.text }] }),
  }, fetcher, true);
  const id = headers.get('x-line-request-id');
  return id ? { requestId: id } : {};
}

export async function generateText(
  config: ProviderConfig,
  input: { instruction: string; text: string; maxOutputTokens: number },
  fetcher: Fetcher = fetch,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  requireValues(config.openaiApiKey, config.openaiModel);
  string(input.instruction, 'AI 指令', 4_000);
  string(input.text, 'AI 輸入', 20_000);
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 128 || input.maxOutputTokens > 2048) {
    throw new ProviderError('INVALID_INPUT', 400, 'AI 輸出預算必須介於 128 至 2048 tokens。');
  }
  const { data } = await request('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiApiKey!}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.openaiModel, store: false, instructions: input.instruction,
      input: input.text, max_output_tokens: input.maxOutputTokens }),
  }, fetcher, true);
  const chunks: string[] = [];
  if (typeof data.output_text === 'string') chunks.push(data.output_text);
  else if (Array.isArray(data.output)) {
    for (const entry of data.output) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as JsonObject;
      if (item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part && typeof part === 'object' && (part as JsonObject).type === 'output_text' && typeof (part as JsonObject).text === 'string') {
          chunks.push((part as JsonObject).text as string);
        }
      }
    }
  }
  const text = chunks.join('\n');
  if (!text || text.length > 100_000) throw new ProviderError('INVALID_UPSTREAM_RESPONSE', 502, 'AI 未回傳可用文字。', true);
  const usage = data.usage && typeof data.usage === 'object' ? data.usage as JsonObject : {};
  return { text, inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0 };
}

export async function transcribeAudio(
  config: ProviderConfig,
  file: { name: string; mime: string; data: Buffer },
  fetcher: Fetcher = fetch,
): Promise<{ text: string }> {
  requireValues(config.openaiApiKey);
  fileInput(file, 10 * 1024 * 1024);
  const audioTypes = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'video/mp4', 'video/webm']);
  if (!audioTypes.has(file.mime)) throw new ProviderError('INVALID_FILE', 400, '語音辨識僅支援 MP3、MP4、WAV 或 WebM。');
  const form = new FormData();
  form.set('model', config.openaiTranscriptionModel ?? 'gpt-4o-mini-transcribe');
  form.set('response_format', 'json');
  form.set('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  const { data } = await request('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiApiKey!}` }, body: form,
  }, fetcher, true);
  return { text: responseString(data.text, true) };
}
