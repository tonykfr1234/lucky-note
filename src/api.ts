import { isLocalMode } from './runtime';
import { localRequest } from './local-api';
let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }
export function getCsrf() { return csrfToken; }
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const isMutation = !!options.method && !['GET', 'HEAD'].includes(options.method);
  if (options.body || isMutation) headers.set('Content-Type', 'application/json');
  if (isMutation) headers.set('X-CSRF-Token', csrfToken);
  const requestOptions = { ...options, body: isMutation ? (options.body || '{}') : options.body, headers, credentials: 'same-origin' as const };
  const response = isLocalMode ? await localRequest(path, requestOptions) : await fetch(path, requestOptions);
  const data = (response.status === 204 ? {} : await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    const english = document.documentElement.lang === 'en';
    const fallback:Record<number,string>={400:'Please check the information and try again.',401:'Please sign in to continue.',403:'You do not have permission for this action.',404:'This item is unavailable or you do not have access.',409:'The item changed or already exists. Reload and compare before trying again.',410:'This operation previously completed, but its result was deleted. Start a new operation if needed.',507:'Device storage is full or unavailable. Your changes were not saved. Export a backup and free some space.',413:'This file or request is too large.',415:'This file type is not supported.',429:'Too many requests. Please try again later.',503:'This service is not configured or is temporarily unavailable.'};
    const byCode:Record<string,string>={LOCAL_SERVER_REQUIRED:'This feature requires your own server. Device-only mode does not connect to external services.',LOCAL_STORAGE_UNAVAILABLE:'Device storage is unavailable. Check browser permissions and reload.',LOCAL_STORAGE_BLOCKED:'Device storage is blocked by another open version. Close other tabs, then reload.',VERIFIED_IDENTITY_REQUIRED:'Sharing requires both accounts to sign in with verified Google identities.'};
    const message = english && data.code && byCode[data.code] ? byCode[data.code] : english && /[\u3400-\u9fff]/.test(data.error||'') ? (fallback[response.status] || 'The request failed. Please try again.') : (data.error || `HTTP ${response.status}`);
    throw new ApiError(response.status, message, data.code);
  }
  return data;
}
export const mutationId = () => crypto.randomUUID();
export function fileData(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read file')); reader.readAsDataURL(file); });
}
