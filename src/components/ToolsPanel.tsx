import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Props = { workspaceId: string; role: string; lang: 'zh-TW' | 'en'; onClose: () => void };
type Integration = { id: string; name: string; configured: boolean; description: string; missing: string[] };
type SourceNote = { id: string; title: string; createdAt: string; notebookId: string | null };
type Notebook = { id: string; name: string };
type Preview = { id: string; items: { noteId: string; title: string; createdAt: string }[]; excludedCount: number; fromDate: string; timeZone: string; source: string; inputText: string; estimatedMaxTokens: number; tokenBudget: number; maxOutputTokens: number };
type Suggestion = { previewId: string; text: string; usage: { inputTokens: number; outputTokens: number }; applied: boolean };
type Tab = 'connections' | 'classification' | 'translation';

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

export default function ToolsPanel({ workspaceId, role, lang, onClose }: Props) {
  const en = lang === 'en';
  const t = (zh: string, english: string) => en ? english : zh;
  const [tab, setTab] = useState<Tab>('connections');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [notes, setNotes] = useState<SourceNote[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(taipeiToday);
  const [timeZone, setTimeZone] = useState('Asia/Taipei');
  const [tokenBudget, setTokenBudget] = useState(8000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(512);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [translationConsent, setTranslationConsent] = useState(false);
  const [translationInput, setTranslationInput] = useState('');
  const [translationTarget, setTranslationTarget] = useState<'繁體中文' | 'English'>('English');
  const [translationOutput, setTranslationOutput] = useState('');
  const translationId = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDivElement>(null);
  const canEdit = role !== 'viewer';
  const aiConfigured = Boolean(integrations.find(item => item.id === 'openai')?.configured);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    setSelected([]); setPreview(null); setSuggestion(null); setAssignments({}); setConsent(false);
    setTranslationInput(''); setTranslationOutput(''); setTranslationConsent(false);
    translationId.current = crypto.randomUUID(); setNotice('');
  }, [workspaceId]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    Promise.all([
      api<{ integrations: Integration[] }>(`/api/integrations?workspaceId=${encodeURIComponent(workspaceId)}`),
      api<{ notes: SourceNote[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/notes`),
      api<{ notebooks: Notebook[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/notebooks`),
    ]).then(([status, source, books]) => {
      if (!current) return;
      setIntegrations(status.integrations);
      setNotes(source.notes);
      setNotebooks(books.notebooks);
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to load tools.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, reload]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  function resetPreview() { setPreview(null); setSuggestion(null); setAssignments({}); setConsent(false); setError(''); setNotice(''); }

  async function makePreview() {
    if (busy || !selected.length || !canEdit) return;
    setBusy(true); setError(''); setNotice(''); setConsent(false); setSuggestion(null);
    try {
      const result = await api<{ preview: Preview; configured: boolean }>(`${base}/ai/preview`, { method: 'POST', body: JSON.stringify({ noteIds: selected, fromDate, timeZone, maxOutputTokens, tokenBudget }) });
      setPreview(result.preview);
      setAssignments(Object.fromEntries(result.preview.items.map(item => [item.noteId, notes.find(note => note.id === item.noteId)?.notebookId ?? ''])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('預覽建立失敗。', 'Preview failed.')); }
    finally { setBusy(false); }
  }
  async function requestSuggestion() {
    if (!preview || !consent || busy || !aiConfigured) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ suggestion: Suggestion }>(`${base}/ai/suggest`, { method: 'POST', body: JSON.stringify({ previewId: preview.id, confirmed: true }) });
      setSuggestion(result.suggestion);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('取得建議失敗；未更動分類。', 'Suggestion failed; classifications were not changed.')); }
    finally { setBusy(false); }
  }
  async function confirmAssignments() {
    if (!preview || !suggestion || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ applied: number }>(`${base}/ai/confirm`, { method: 'POST', body: JSON.stringify({ previewId: preview.id, confirmed: true, assignments: preview.items.map(item => ({ noteId: item.noteId, notebookId: assignments[item.noteId] || null })) }) });
      setNotice(t(`已依你的選擇更新 ${result.applied} 篇筆記。`, `Updated ${result.applied} notes using your selections.`));
      setPreview(null); setSuggestion(null); setConsent(false); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('分類更新失敗。', 'Could not apply classifications.')); }
    finally { setBusy(false); }
  }
  async function translate() {
    if (!translationInput.trim() || !translationConsent || busy || !aiConfigured) return;
    setBusy(true); setError(''); setTranslationOutput('');
    try {
      const result = await api<{ text: string }>(`${base}/tools/translate`, { method: 'POST', body: JSON.stringify({ text: translationInput, targetLanguage: translationTarget, maxOutputTokens, tokenBudget, confirmed: true, clientMutationId: translationId.current }) });
      setTranslationOutput(result.text);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('翻譯失敗。', 'Translation failed.')); }
    finally { setBusy(false); }
  }

  const services: Record<string, { glyph: string; zh: string; en: string }> = {
    google: { glyph: 'G', zh: 'Google 登入', en: 'Google sign-in' },
    drive: { glyph: '△', zh: 'Google Drive 附件', en: 'Google Drive attachments' },
    calendar: { glyph: '31', zh: 'Google 日曆', en: 'Google Calendar' },
    gmail: { glyph: 'M', zh: 'Gmail 寄信', en: 'Gmail delivery' },
    line: { glyph: 'L', zh: 'LINE 訊息推播', en: 'LINE messaging' },
    openai: { glyph: '✧', zh: 'AI 分類與翻譯', en: 'AI sorting & translation' },
    stt: { glyph: '♪', zh: '語音轉文字', en: 'Speech to text' },
  };
  const explanations: Record<string, string> = {
    google: t('登入使用獨立 OAuth 設定；登入不會同時授權 Drive、日曆或 Gmail。', 'Sign-in has its own OAuth configuration. It does not authorize Drive, Calendar, or Gmail.'),
    drive: t('附件可交給群組自己的 Drive 資料夾；筆記同步與權限仍由本服務管理。', 'Store attachments in your group’s Drive folder. Note synchronization and permissions stay with this service.'),
    calendar: t('群組專屬日曆綁定與 server-side adapter 已提供；目前介面不會自動建立事件。', 'A group-specific calendar binding and server adapter are available. This panel does not automatically create events.'),
    gmail: t('使用獨立寄信授權與明確收件人；目前介面不會自動寄送郵件。', 'Uses separate sending authorization and explicit recipients. This panel does not automatically send email.'),
    line: t('採 LINE Official Account Messaging API；需先明確綁定群組，不傳送私人筆記。', 'Uses LINE Official Account Messaging API with explicit group binding. Private notes are not sent.'),
    openai: t('API 金鑰只保存在伺服器。先選來源、預覽與確認，才向模型送出。', 'API keys remain on the server. Select a source, review it, and confirm before sending to the model.'),
    stt: t('可插拔轉錄 adapter 已備妥；音訊預算與操作介面尚未啟用。沒有自動錄音或背景監聽。', 'A pluggable transcription adapter is ready. The audio budget and interface are not enabled. No automatic recording or background listening.'),
  };

  return <div className="modal-backdrop">
    <div className="modal tools-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tools-title" style={{ width: 'min(1000px, calc(100vw - 32px))', maxWidth: 1000 }} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const items = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]!; const last = items[items.length - 1]!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="panel-header"><div><span className="eyebrow">YOUR CONNECTED SPACE</span><h2 id="tools-title">{t('工具與整合', 'Tools & integrations')}</h2></div><button className="button icon-button" onClick={onClose} disabled={busy} aria-label={t('關閉工具', 'Close tools')}>×</button></div>
      <p className="muted">{t('讓工具在你需要時，走進筆記裡。', 'Useful tools, right where your ideas live.')}</p>
      <div role="tablist" aria-label={t('工具分類', 'Tool categories')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '20px 0' }}>{([
        ['connections', t('服務連線', 'Connections')], ['classification', t('分類助理', 'Sorting assistant')], ['translation', t('文字翻譯', 'Translation')],
      ] as [Tab, string][]).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`button ${tab === value ? 'primary' : ''}`} onClick={() => { setTab(value); setError(''); }} disabled={busy}>{label}</button>)}</div>
      {loading && <p className="status" role="status">{t('正在讀取服務設定…', 'Reading service configuration…')}</p>}
      {error && <div className="error" role="alert">{error}{!integrations.length && <button className="button" onClick={() => setReload(value => value + 1)}>{t('重新讀取', 'Retry')}</button>}</div>}
      {notice && <p className="status" role="status">{notice}</p>}
      {!loading && tab === 'connections' && <div role="tabpanel">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 14 }}>{integrations.map(integration => <article key={integration.id} style={{ border: '1px solid var(--line, #dce3de)', borderRadius: 16, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', height: 36, minWidth: 36, borderRadius: 10, background: 'var(--surface-soft, #e8f1eb)', color: 'var(--primary, #276347)', fontWeight: 800 }}>{services[integration.id]?.glyph || '＋'}</span><span className={`status ${integration.configured ? 'configured' : ''}`} style={{ fontSize: 12 }}>{integration.configured ? t('已配置・尚需端到端驗證', 'Configured · needs live verification') : t('尚未配置', 'Not configured')}</span></div>
          <h3 style={{ margin: '14px 0 8px', fontSize: 16 }}>{services[integration.id] ? (en ? services[integration.id]!.en : services[integration.id]!.zh) : integration.name}</h3>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{explanations[integration.id] || integration.description}</p>
          {!!integration.missing?.length && <details style={{ fontSize: 12 }}><summary>{t('伺服器需要的設定', 'Required server settings')}</summary><ul style={{ overflowWrap: 'anywhere', paddingLeft: 18 }}>{integration.missing.map(item => <li key={item}><code>{item}</code></li>)}</ul></details>}
        </article>)}</div>
        <p className="muted" style={{ marginTop: 20, fontSize: 13 }}>{t('Google Photos 需由使用者主動選取媒體；PWA 不會掃描手機相簿。LINE Pay 不提供此 App 代轉帳；分帳請使用帳本的結清建議。', 'Google Photos requires user-selected media. This PWA does not scan your photo library. LINE Pay transfers are not provided; use settlement suggestions in the ledger.')}</p>
      </div>}
      {!loading && tab === 'classification' && <div role="tabpanel">
        <div className="status" style={{ padding: 14, borderRadius: 12, background: 'var(--surface-soft, #e8f1eb)', marginBottom: 18 }}><strong>{t('只分析你選取的筆記中繼資料', 'Only selected note metadata')}</strong><p style={{ marginBottom: 0, fontSize: 13 }}>{t('此版只提供標題、標籤與候選筆記本的分類建議；AI 不會收到筆記正文、照片、影片或相簿，也不會自動移動內容或通知群組。', 'This version suggests categories using titles, tags, and candidate notebooks. The AI does not receive note bodies, photos, videos, or libraries, and never moves notes or notifies groups automatically.')}</p></div>
        {!canEdit && <p className="muted">{t('你目前只有檢視權限，分類功能需要編輯權限。', 'Sorting requires editor permissions.')}</p>}
        {!preview ? <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 14 }}>
            <label className="field">{t('起始日期（建立時間）', 'Starting date (creation time)')}<input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} disabled={busy || !canEdit} /></label>
            <label className="field">{t('日期時區', 'Date timezone')}<select value={timeZone} onChange={e => setTimeZone(e.target.value)} disabled={busy || !canEdit}><option value="Asia/Taipei">Asia/Taipei (UTC+8)</option><option value="UTC">UTC</option></select></label>
            <label className="field">{t('單次 token 上限', 'Request token budget')}<input type="number" min={256} max={12000} step={256} value={tokenBudget} onChange={e => { setTokenBudget(Number(e.target.value)); translationId.current = crypto.randomUUID(); }} disabled={busy || !canEdit} /></label>
            <label className="field">{t('輸出 token 上限', 'Maximum output tokens')}<select value={maxOutputTokens} onChange={e => { setMaxOutputTokens(Number(e.target.value)); translationId.current = crypto.randomUUID(); }} disabled={busy || !canEdit}><option value={256}>256</option><option value={512}>512</option><option value={1024}>1024</option></select></label>
          </div>
          <fieldset style={{ border: '1px solid var(--line, #dce3de)', borderRadius: 12, padding: 14, margin: '18px 0', maxHeight: 260, overflowY: 'auto' }} disabled={busy || !canEdit}><legend>{t('選取來源筆記', 'Select source notes')} · {selected.length}</legend>{notes.length ? notes.map(note => <label key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}><input type="checkbox" checked={selected.includes(note.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, note.id] : previous.filter(id => id !== note.id))} /><span style={{ flex: 1, overflowWrap: 'anywhere' }}>{note.title || t('未命名筆記', 'Untitled note')}</span><small className="muted">{new Date(note.createdAt).toLocaleDateString(lang)}</small></label>) : <p className="muted">{t('這個空間還沒有筆記。先建立一篇，再回來選取來源。', 'No notes in this space yet. Create a note, then select it here.')}</p>}</fieldset>
          <button className="button primary" disabled={busy || !canEdit || !selected.length || !fromDate || !Number.isInteger(tokenBudget) || tokenBudget < 256 || tokenBudget > 12000} onClick={() => void makePreview()}>{busy ? t('準備中…', 'Preparing…') : t('預覽選取內容（不會送往 AI）', 'Preview selection (no AI request)')}</button>
        </> : <>
          <h3>{t('確認將送出的內容', 'Review the exact content')}</h3>
          <p className="muted">{t(`${preview.items.length} 篇符合日期條件；排除 ${preview.excludedCount} 篇。`, `${preview.items.length} notes meet the date filter; ${preview.excludedCount} excluded.`)} {preview.fromDate} · {preview.timeZone}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto', border: '1px solid var(--line, #dce3de)', borderRadius: 12, padding: 14, fontSize: 13 }}>{preview.inputText}</pre>
          <p className="muted">{t(`預估 token 上限 ${preview.estimatedMaxTokens}；本次預算 ${preview.tokenBudget}。API 費用與 ChatGPT 訂閱分開計費。`, `Estimated maximum: ${preview.estimatedMaxTokens} tokens; budget: ${preview.tokenBudget}. API charges are separate from a ChatGPT subscription.`)}</p>
          {!aiConfigured && <p className="status">{t('OpenAI 尚未配置；此預覽留在本服務，無法取得模型建議。', 'OpenAI is not configured. This preview stays in this service; model suggestions are unavailable.')}</p>}
          {!suggestion && <><label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0' }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy || !aiConfigured} /><span>{t('我確認把上方選取的中繼資料送給 OpenAI，並使用本次 token 預算。', 'I confirm sending the selected metadata above to OpenAI within this token budget.')}</span></label><button className="button primary" disabled={busy || !consent || !aiConfigured || !preview.items.length} onClick={() => void requestSuggestion()}>{busy ? t('取得建議中…', 'Getting suggestions…') : t('確認送出並取得分類建議', 'Confirm & request suggestions')}</button></>}
          {suggestion && <><h3>{t('AI 建議，尚未套用', 'AI suggestions · not applied')}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.7 }}>{suggestion.text}</pre><p className="muted">{t(`使用量：輸入 ${suggestion.usage.inputTokens} / 輸出 ${suggestion.usage.outputTokens} tokens`, `Usage: ${suggestion.usage.inputTokens} input / ${suggestion.usage.outputTokens} output tokens`)}</p><h3>{t('由你決定放進哪個筆記本', 'You choose the destination')}</h3>{preview.items.map(item => <label className="field" key={item.noteId} style={{ marginBottom: 12 }}>{item.title}<select value={assignments[item.noteId] ?? ''} onChange={e => setAssignments(previous => ({ ...previous, [item.noteId]: e.target.value }))} disabled={busy}><option value="">{t('未分類', 'Unfiled')}</option>{notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}</select></label>)}<button className="button primary" disabled={busy} onClick={() => void confirmAssignments()}>{busy ? t('套用中…', 'Applying…') : t('確認套用我的分類', 'Apply my classifications')}</button></>}
          <button className="button" style={{ marginLeft: 10, marginTop: 10 }} onClick={resetPreview} disabled={busy}>{t('取消預覽', 'Cancel preview')}</button>
        </>}
      </div>}
      {!loading && tab === 'translation' && <div role="tabpanel">
        <p className="muted">{t('只送出下方你自行輸入的文字。翻譯結果不會自動覆寫任何筆記。', 'Only the text you enter below is sent. Results never overwrite a note automatically.')}</p>
        {!aiConfigured && <p className="status">{t('OpenAI 尚未配置。請由管理者在伺服器端設定；不要在這裡貼上 API key。', 'OpenAI is not configured. Ask an administrator to configure the server; do not paste API keys here.')}</p>}
        <label className="field">{t('要翻譯的文字', 'Text to translate')}<textarea rows={7} maxLength={12000} value={translationInput} onChange={event => { setTranslationInput(event.target.value); setTranslationConsent(false); setTranslationOutput(''); translationId.current = crypto.randomUUID(); }} disabled={busy || !canEdit} placeholder={t('貼上或輸入要翻譯的一段文字…', 'Type or paste the text to translate…')} /></label>
        <label className="field" style={{ marginTop: 14 }}>{t('目標語言', 'Target language')}<select value={translationTarget} onChange={event => { setTranslationTarget(event.target.value as '繁體中文' | 'English'); setTranslationConsent(false); setTranslationOutput(''); translationId.current = crypto.randomUUID(); }} disabled={busy || !canEdit}><option value="English">English</option><option value="繁體中文">繁體中文</option></select></label>
        <p className="muted">{t(`本次 token 預算 ${tokenBudget}，輸出上限 ${maxOutputTokens}。可在「分類助理」調整。`, `Token budget: ${tokenBudget}; output limit: ${maxOutputTokens}. Adjust these in Sorting assistant.`)}</p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0' }}><input type="checkbox" checked={translationConsent} onChange={event => setTranslationConsent(event.target.checked)} disabled={busy || !aiConfigured || !canEdit} /><span>{t('我確認將以上文字送至 OpenAI 翻譯。', 'I confirm sending the text above to OpenAI for translation.')}</span></label>
        <button className="button primary" disabled={busy || !aiConfigured || !canEdit || !translationConsent || !translationInput.trim()} onClick={() => void translate()}>{busy ? t('翻譯中…', 'Translating…') : t('確認並翻譯', 'Confirm & translate')}</button>
        {!!translationOutput && <div style={{ marginTop: 24 }}><h3>{t('翻譯結果', 'Translation')}</h3><textarea rows={7} value={translationOutput} readOnly aria-label={t('翻譯結果', 'Translation result')} style={{ width: '100%' }} /><p className="muted">{t('可選取並複製文字到筆記；內容仍需自行核對。', 'Select and copy into a note. Please review the translation.')}</p></div>}
      </div>}
    </div>
  </div>;
}
