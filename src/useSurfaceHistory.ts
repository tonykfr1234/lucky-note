import { useEffect, useRef } from 'react';
import type { Lang } from './types';

type View = { noteId: string | null; dialog: string | null };
type Props = View & { dirty: boolean; lang: Lang; closeDialog: () => void; closeNote: () => void };
/** Same-URL navigation lets Android/browser Back dismiss one visible app surface. */
export function useSurfaceHistory(props: Props) {
  const live = useRef(props); live.current = props;
  const instance = useRef(crypto.randomUUID());
  const previous = useRef<View>({ noteId: null, dialog: null });
  const fromHistory = useRef(false), pendingManualBack = useRef(false);
  const frame = (view: View) => ({ ...window.history.state, luckynoteView: { instance: instance.current, noteId: view.noteId, dialog: view.dialog } });
  useEffect(() => {
    window.history.replaceState(frame({ noteId: live.current.noteId, dialog: live.current.dialog }), '');
    const back = () => {
      const current = live.current;
      if (pendingManualBack.current) { pendingManualBack.current = false; window.history.replaceState(frame(current), ''); return; }
      if (current.dialog) { fromHistory.current = true; current.closeDialog(); return; }
      if (current.noteId) {
        if (current.dirty && !window.confirm(current.lang === 'zh-TW' ? '仍有未儲存或未同步的變更。關閉筆記會捨棄這些變更，確定離開？' : 'Some changes are not saved or synced. Closing this note discards them. Leave this note?')) {
          window.history.pushState(frame(current), ''); return;
        }
        fromHistory.current = true; current.closeNote();
      }
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const next = { noteId: props.noteId, dialog: props.dialog }, old = previous.current;
    previous.current = next;
    if (fromHistory.current) { fromHistory.current = false; window.history.replaceState(frame(next), ''); return; }
    if (next.noteId === old.noteId && next.dialog === old.dialog) return;
    if (old.dialog && !next.dialog && next.noteId && next.noteId !== old.noteId) { window.history.replaceState(frame(next), ''); return; }
    if ((next.dialog && next.dialog !== old.dialog) || (next.noteId && !old.noteId)) { window.history.pushState(frame(next), ''); return; }
    if ((old.dialog && !next.dialog) || (old.noteId && !next.noteId)) {
      if (window.history.state?.luckynoteView?.instance === instance.current) { pendingManualBack.current = true; window.history.back(); }
      else window.history.replaceState(frame(next), '');
      return;
    }
    window.history.replaceState(frame(next), '');
  }, [props.noteId, props.dialog]);
}
