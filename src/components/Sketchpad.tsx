import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number };
type Props = { lang: 'zh-TW' | 'en'; initialData?: string; onSave: (dataUrl: string, serialized: string) => Promise<void>; onClose: () => void };

function parseDrawing(value?: string): Stroke[] {
  if (!value) return [];
  if (value.length > 250000) throw new Error('Drawing exceeds 250 KB');
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 2000) throw new Error('Invalid drawing');
  for (const item of parsed as Stroke[]) {
    if (!item || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color) || typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width < 1 || item.width > 100 || !Array.isArray(item.points) || item.points.length > 10000 || item.points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Invalid drawing');
  }
  return parsed as Stroke[];
}

export default function Sketchpad({ lang, initialData, onSave, onClose }: Props) {
  const en = lang === 'en';
  const t = (zh: string, english: string) => en ? english : zh;
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const history = useRef<Stroke[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>(() => { try { return parseDrawing(initialData); } catch { return []; } });
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [color, setColor] = useState('#243f36');
  const [width, setWidth] = useState(3);
  const [eraser, setEraser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() => { try { parseDrawing(initialData); return ''; } catch { return en ? 'The stored drawing is invalid. Cancel to keep the original note.' : '原有筆跡資料無法讀取；請取消以保留原始筆記。'; } });

  function change(lines: Stroke[]) { const previousLines = history.current; history.current = lines; setPast(previous => [...previous, previousLines]); setFuture([]); setStrokes(lines); }
  function undo() { if (!past.length || active.current) return; const previousLines = history.current; const next = past[past.length - 1]!; setFuture(previous => [...previous, previousLines]); history.current = next; setStrokes(next); setPast(previous => previous.slice(0, -1)); }
  function redo() { if (!future.length || active.current) return; const previousLines = history.current; const next = future[future.length - 1]!; setPast(previous => [...previous, previousLines]); history.current = next; setStrokes(next); setFuture(previous => previous.slice(0, -1)); }

  function paint(target: HTMLCanvasElement, lines: Stroke[], preview: Stroke | null = null) {
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    for (const line of preview ? [...lines, preview] : lines) {
      if (!line.points.length) continue;
      ctx.strokeStyle = line.color;
      ctx.fillStyle = line.color;
      ctx.lineWidth = line.width * target.width / 900;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = line.points[0]!;
      ctx.moveTo(first.x * target.width, first.y * target.height);
      if (line.points.length === 1) {
        ctx.arc(first.x * target.width, first.y * target.height, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (const p of line.points.slice(1)) ctx.lineTo(p.x * target.width, p.y * target.height);
        ctx.stroke();
      }
    }
  }

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(bounds.width * scale);
      element.height = Math.round(bounds.height * scale);
      paint(element, history.current, active.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    history.current = strokes;
    if (canvas.current) paint(canvas.current, strokes);
  }, [strokes]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  function point(e: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)) };
  }
  function begin(e: PointerEvent<HTMLCanvasElement>) {
    if (saving || active.current || e.button !== 0) return;
    if (history.current.length >= 2000) { setError(t('筆畫已達 2,000 筆，請復原或清空部分筆跡。', 'The 2,000-stroke limit has been reached. Undo or clear some strokes.')); return; }
    if (eraser && !history.current.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointer.current = e.pointerId;
    active.current = { color: eraser ? '#ffffff' : color, width: eraser ? width * 5 : width, points: [point(e)] };
    paint(e.currentTarget, history.current, active.current);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!active.current || e.pointerId !== activePointer.current || active.current.points.length >= 10000) return;
    active.current.points.push(point(e));
    paint(e.currentTarget, history.current, active.current);
  }
  function end(e: PointerEvent<HTMLCanvasElement>) {
    if (!active.current || e.pointerId !== activePointer.current) return;
    const line = active.current;
    active.current = null;
    activePointer.current = null;
    change([...history.current, line]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  async function save() {
    if (saving || strokes.length === 0) return;
    if (active.current) { setError(t('請先完成目前的筆畫，再儲存。', 'Finish your current stroke before saving.')); return; }
    setSaving(true);
    setError('');
    try {
      const exported = document.createElement('canvas');
      exported.width = 1800;
      exported.height = 960;
      paint(exported, strokes);
      const serialized = JSON.stringify(strokes);
      if (serialized.length > 250000) throw new Error(t('筆跡超過 250 KB，請減少筆畫後再儲存。', 'Drawing exceeds 250 KB. Remove some strokes before saving.'));
      await onSave(exported.toDataURL('image/png'), serialized);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('儲存失敗，畫布仍保留。', 'Save failed. Your drawing is still here.'));
    } finally { setSaving(false); }
  }

  return <div className="modal-backdrop">
    <div className="modal sketchpad-modal" style={{ width: 'min(1000px, calc(100vw - 32px))', maxWidth: 1000 }} role="dialog" aria-modal="true" aria-labelledby="sketchpad-title" tabIndex={-1} ref={dialog} onKeyDown={e => {
      if (e.key === 'Escape' && !saving) onClose();
      if (e.key === 'Tab') {
        const items = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="panel-header"><div><span className="eyebrow">CANVAS</span><h2 id="sketchpad-title">{t('把想法畫下來', 'Make room for ideas')}</h2></div><button className="button icon-button" onClick={onClose} disabled={saving} aria-label={t('關閉手寫白板', 'Close sketchpad')}>×</button></div>
      <p className="muted">{t('用手指、觸控筆或滑鼠自由書寫。筆跡可再次編輯，並會產生 PNG 附件。', 'Draw with a finger, stylus, or mouse. Editable strokes are saved with a PNG attachment.')}</p>
      <div className="sketch-toolbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '16px 0' }}>
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{t('筆色', 'Color')}<input type="color" value={color} onChange={e => { setColor(e.target.value); setEraser(false); }} aria-label={t('筆色', 'Pen color')} disabled={saving} style={{ width: 42, height: 34, padding: 2 }} /></label>
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{t('粗細', 'Size')}<select value={width} onChange={e => setWidth(Number(e.target.value))} disabled={saving} aria-label={t('筆畫粗細', 'Stroke width')}><option value={2}>2</option><option value={3}>3</option><option value={6}>6</option><option value={12}>12</option></select></label>
        <button className={`button ${eraser ? 'primary' : ''}`} onClick={() => setEraser(value => !value)} aria-pressed={eraser} disabled={saving}>{t('橡皮擦', 'Eraser')}</button>
        <button className="button" onClick={undo} disabled={!past.length || saving}>{t('復原', 'Undo')}</button>
        <button className="button" onClick={redo} disabled={!future.length || saving}>{t('重做', 'Redo')}</button>
        <button className="button" onClick={() => { active.current = null; activePointer.current = null; change([]); }} disabled={!strokes.length || saving}>{t('清空', 'Clear')}</button>
      </div>
      <canvas ref={canvas} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label={t('自由手寫畫布', 'Freehand drawing canvas')} style={{ width: '100%', aspectRatio: '900 / 480', display: 'block', background: 'white', border: '1px solid #d6dfda', borderRadius: 14, touchAction: 'none', cursor: eraser ? 'cell' : 'crosshair' }} />
      <p className="muted" style={{ fontSize: 12 }}>{t('白板需要指標或觸控操作；也可以關閉後使用可鍵盤操作的文字筆記。取消不會上傳畫布。', 'Drawing uses a pointer or touch. Text notes remain fully keyboard accessible. Cancel does not upload the canvas.')}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}><button className="button" onClick={onClose} disabled={saving}>{t('取消', 'Cancel')}</button><button className="button primary" onClick={() => void save()} disabled={!strokes.length || saving}>{saving ? t('儲存中…', 'Saving…') : t('儲存到筆記', 'Save to note')}</button></div>
    </div>
  </div>;
}
