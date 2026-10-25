import { useEffect } from 'react';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import type { ToastItem } from '../../state/types';

const TOAST_MS = 4500;

function Toast({ toast }: { toast: ToastItem }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast.id, dismiss]);
  return (
    <div className="pointer-events-auto rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm shadow-lg">
      {t(toast.key, toast.params)}
    </div>
  );
}

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((x) => (
        <Toast key={x.id} toast={x} />
      ))}
    </div>
  );
}
