type SaveResult = 'saved' | 'cancelled' | 'requested';
interface ExportBridge {
  postMessage(message: string): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
}
declare global { interface Window { LuckyNoteExport?: ExportBridge } }
const pending = new Map<string, { resolve: (result: SaveResult) => void; reject: (error: Error) => void }>();
function failure(zh: string, en: string) { return new Error(document.documentElement.lang === 'en' ? en : zh); }
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(failure('無法讀取匯出內容。', 'Unable to read export data.'));
    reader.readAsDataURL(blob);
  });
}

/** Android uses one origin-restricted save channel and the system file picker. */
export async function saveDownload(blob: Blob, name: string): Promise<SaveResult> {
  const bridge = window.LuckyNoteExport;
  if (!bridge) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'requested'; // Browsers do not report whether the OS download finished.
  }
  if (pending.size) throw failure('請先完成或取消目前的匯出。', 'Complete or cancel the current export first.');
  if (blob.size > 10 * 1024 * 1024) throw failure('APK 單次匯出上限為 10 MB，請分開筆記本匯出。', 'The APK export limit is 10 MB. Split large exports.');
  const mime = blob.type.split(';')[0] || 'text/plain';
  if (!['application/json', 'text/plain', 'text/markdown'].includes(mime)) throw failure('APK 不支援這個匯出格式。', 'This export format is unavailable in the APK.');
  const data = await base64(blob), id = crypto.randomUUID();
  bridge.onmessage = event => {
    try {
      const result = JSON.parse(event.data) as { id?: string; status?: string; error?: string };
      const entry = result.id ? pending.get(result.id) : undefined;
      if (!entry || !result.id) return;
      pending.delete(result.id);
      if (result.status === 'saved' || result.status === 'cancelled' || result.status === 'cancel') entry.resolve(result.status === 'saved' ? 'saved' : 'cancelled');
      else entry.reject(failure('匯出失敗，沒有確認儲存檔案。', 'Export failed; no saved file was confirmed.'));
    } catch { /* Ignore unrelated malformed bridge messages; no success is inferred. */ }
  };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { bridge.postMessage(JSON.stringify({ id, name: [...name].map(char => char.charCodeAt(0) < 32 || char === '/' || char === String.fromCharCode(92) ? '_' : char).join('').slice(0,120), mime, base64: data })); }
    catch { pending.delete(id); reject(failure('無法開啟系統儲存選擇器。', 'Unable to open the system save picker.')); }
  });
}
