import { useState } from 'react';
import { extractToken } from '../../core/signaling/link';
import { readText } from '../../core/platform/clipboard';
import { t } from '../../i18n';
import { useStore } from '../../state/store';
import { useSettle } from '../hooks/useSettle';
import { ErrorPanel } from './ErrorPanel';
import { ScanIcon } from './Icons';
import { QrScannerDialog } from './QrScannerDialog';

const SETTLE_MS = 400;

/** Step 2 on the caller: paste/scan the reply; it submits itself as soon as it looks complete. */
export function ReplyBox() {
  const submit = useStore((s) => s.submitReply);
  const error = useStore((s) => s.replyError);
  const clearError = useStore((s) => s.clearReplyError);
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const { schedule, cancel } = useSettle(SETTLE_MS);

  const change = (value: string) => {
    setText(value);
    clearError();
    cancel();
    if (!value.trim()) return;
    // Wait for the paste to settle, then submit; a bad code shows its error right away.
    schedule(() => void submit(value));
  };

  const paste = async () => {
    const pasted = await readText();
    if (pasted) change(pasted);
  };

  return (
    <div className="space-y-3">
      <textarea
        data-testid="reply-input"
        aria-label={t('create.replyLabel')}
        placeholder={t('create.replyPlaceholder')}
        className="field h-24 font-mono text-xs"
        value={text}
        onChange={(e) => change(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          data-testid="reply-scan"
          onClick={() => setScanning(true)}
        >
          <ScanIcon /> {t('create.scanReply')}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="reply-paste"
          onClick={() => void paste()}
        >
          {t('common.paste')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="reply-submit"
          disabled={!extractToken(text)}
          onClick={() => void submit(text)}
        >
          {t('create.connect')}
        </button>
      </div>
      {error ? <ErrorPanel message={error} /> : null}
      {scanning ? (
        <QrScannerDialog
          onClose={() => setScanning(false)}
          onResult={(value) => {
            setScanning(false);
            change(value);
          }}
        />
      ) : null}
    </div>
  );
}
