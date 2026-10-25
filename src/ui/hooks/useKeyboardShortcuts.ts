import { useEffect } from 'react';
import { useStore } from '../../state/store';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** In-call shortcuts: M mic, V camera, S stats, Ctrl/Cmd+D hang up (asks first). */
export function useKeyboardShortcuts(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.askConfirm('end-call');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'm') s.setMic(!s.local.micOn);
      else if (key === 'v') void s.setCam(!s.local.camOn);
      else if (key === 's') s.setHud(!s.hudOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
