import { isLocalMode } from '../runtime';
import type { Lang } from '../types';
import { Icon } from './Icon';

export function LocalModeNotice({ lang }: { lang: Lang }) {
  if (!isLocalMode) return null;
  const preview = import.meta.env.VITE_DEMO_SEED === 'true';
  const zh = lang === 'zh-TW';
  return <div className="info-banner local-mode-banner" role="note"><Icon name="lock" size={17}/><span><strong>{zh ? (preview ? '本機預覽：' : '本機模式：') : (preview ? 'Local preview: ' : 'Device-only mode: ')}</strong>{zh ? (preview ? '資料只在此瀏覽器，無跨裝置／Google／LINE連線。' : '資料只在此裝置的瀏覽器／App，無跨裝置／Google／LINE連線。') : (preview ? 'Data stays in this browser. No cross-device sync, Google or LINE connection.' : 'Data stays in this browser or app on this device. No cross-device sync, Google or LINE connection.')}<small>{zh ? '請定期匯出；清除網站資料或移除 App 可能刪除筆記。' : 'Export backups regularly. Clearing site data or uninstalling may delete notes.'}</small></span></div>;
}
