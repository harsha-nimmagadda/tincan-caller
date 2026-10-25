import { QRCodeSVG } from 'qrcode.react';
import { t } from '../../i18n';

interface Props {
  /** The full link: phones' native camera apps can open it directly. */
  value: string;
  testId: string;
}

export function QrCode({ value, testId }: Props) {
  return (
    <div data-testid={testId} data-link={value} className="mx-auto w-fit rounded-2xl bg-white p-2">
      <QRCodeSVG value={value} size={256} level="M" marginSize={2} role="img" title={t('qr.alt')} />
    </div>
  );
}
