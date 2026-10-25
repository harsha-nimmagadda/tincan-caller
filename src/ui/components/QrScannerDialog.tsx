import { useEffect, useRef, useState } from 'react';
import { decodeImageFile, QrScanner, type ScanFailure } from '../../core/media/qr-scanner';
import { isMobileDevice } from '../../core/platform/orientation';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';
import { Dialog } from './Dialog';

const FAILURE: Record<ScanFailure, MessageKey> = {
  'permission-denied': 'qr.denied',
  'no-camera': 'qr.noCamera',
  unknown: 'qr.failed',
};

interface Props {
  onResult(text: string): void;
  onClose(): void;
}

/** Scan with the camera, or pick a picture of the code. Releases the camera when closed. */
export function QrScannerDialog({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const [notFound, setNotFound] = useState(false);
  const beginScan = useStore((s) => s.beginScan);
  const endScan = useStore((s) => s.endScan);
  const local = useStore((s) => s.local);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner();
    let resume = false;
    let cancelled = false;
    // Desktop: scan with the camera already open. Phones: free the camera, scan, give it back.
    void (async () => {
      resume = await beginScan();
      if (cancelled) return void endScan(resume);
      const reuse = !isMobileDevice() && local.camOn ? local.stream : null;
      const result = await scanner.start(video, (text) => onResult(text), reuse);
      if (!cancelled) setFailure(result);
    })();
    return () => {
      cancelled = true;
      scanner.stop();
      video.srcObject = null;
      void endScan(resume);
    };
    // The scanner session is tied to this dialog's lifetime only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await decodeImageFile(file);
    if (text) onResult(text);
    else setNotFound(true);
  };

  return (
    <Dialog title={t('qr.title')} onClose={onClose} testId="qr-scanner">
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label={t('qr.preview')}
        className="aspect-square w-full rounded-xl bg-black object-cover"
      />
      {failure ? (
        <p role="alert" className="text-red-300">
          {t(FAILURE[failure])}
        </p>
      ) : (
        <p className="muted">{t('qr.hint')}</p>
      )}
      {notFound ? (
        <p role="alert" className="text-red-300">
          {t('qr.notFound')}
        </p>
      ) : null}
      <label className="btn w-full cursor-pointer">
        {t('qr.upload')}
        <input
          type="file"
          accept="image/*"
          data-testid="qr-upload"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      <button type="button" className="btn w-full" data-autofocus onClick={onClose}>
        {t('common.cancel')}
      </button>
    </Dialog>
  );
}
