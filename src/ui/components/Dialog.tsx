import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  body?: string;
  children?: ReactNode;
  onClose(): void;
  testId?: string;
}

/** Modal dialog: focus moves in, Escape closes, focus returns to the opener. */
export function Dialog({ title, body, children, onClose, testId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh closure every render. Depending on it would re-run the effect (and re-focus
  // the Close button) on every re-render, which collapses an open <select> popup instantly.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="card w-full max-w-md space-y-3 shadow-2xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {body ? <p className="muted">{body}</p> : null}
        {children}
      </div>
    </div>
  );
}
