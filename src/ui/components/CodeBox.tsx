import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { CopyIcon } from './Icons';

interface Props {
  token: string;
  testId: string;
  summaryKey: MessageKey;
}

/** The raw code, for pasting into a chat when QR/links are awkward. Collapsed by default. */
export function CodeBox({ token, testId, summaryKey }: Props) {
  const copy = useStore((s) => s.copy);
  return (
    <details className="rounded-xl border border-slate-700 p-3">
      <summary className="cursor-pointer text-sm">{t(summaryKey)}</summary>
      <textarea
        readOnly
        value={token}
        data-testid={testId}
        aria-label={t(summaryKey)}
        className="field mt-2 h-24 font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn mt-2" onClick={() => void copy(token)}>
        <CopyIcon /> {t('common.copyCode')}
      </button>
    </details>
  );
}
