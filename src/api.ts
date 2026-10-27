let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }
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
  const response = await fetch(path, { ...options, body: isMutation ? (options.body || '{}') : options.body, headers, credentials: 'same-origin' });
  const data = (response.status === 204 ? {} : await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    const english = document.documentElement.lang === 'en';
    const fallback:Record<number,string>={400:'Please check the information and try again.',401:'Please sign in to continue.',403:'You do not have permission for this action.',404:'This item is unavailable or you do not have access.',409:'The item changed or already exists. Reload and compare before trying again.',413:'This file or request is too large.',415:'This file type is not supported.',429:'Too many requests. Please try again later.',503:'This service is not configured or is temporarily unavailable.'};
    const message = english && /[\u3400-\u9fff]/.test(data.error||'') ? (fallback[response.status] || 'The request failed. Please try again.') : (data.error || `HTTP ${response.status}`);
    throw new ApiError(response.status, message, data.code);
  }
  return data;
}
export const mutationId = () => crypto.randomUUID();
export function fileData(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read file')); reader.readAsDataURL(file); });
}
