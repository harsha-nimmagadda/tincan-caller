import type { ReactNode } from 'react';
import { t } from '../../i18n';
import type { Message } from '../../state/types';

export function ErrorPanel({ message, children }: { message: Message; children?: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid="error-panel"
      data-error={message.key}
      className="rounded-xl border border-red-500/60 bg-red-950/60 p-3 text-red-100"
    >
      <p>{t(message.key, message.params)}</p>
      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
