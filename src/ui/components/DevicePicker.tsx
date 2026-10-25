import { supportsSinkId, type DeviceKind } from '../../core/media/devices';
import { t, type MessageKey } from '../../i18n';
import { useStore } from '../../state/store';

const LABEL: Record<DeviceKind, MessageKey> = {
  audioinput: 'devices.mic',
  videoinput: 'devices.camera',
  audiooutput: 'devices.speaker',
};
const FALLBACK: Record<DeviceKind, MessageKey> = {
  audioinput: 'devices.micN',
  videoinput: 'devices.cameraN',
  audiooutput: 'devices.speakerN',
};

/** Microphone / camera / speaker selects. Speakers show only where `setSinkId` exists. */
export function DevicePicker() {
  const devices = useStore((s) => s.devices);
  const preferred = useStore((s) => s.preferredDevices);
  const local = useStore((s) => s.local);
  const setDevice = useStore((s) => s.setDevice);
  const kinds: DeviceKind[] = [
    'audioinput',
    'videoinput',
    ...(supportsSinkId() ? (['audiooutput'] as const) : []),
  ];

  return (
    <div className="space-y-3">
      {kinds.map((kind) => {
        const list = devices[kind];
        if (list.length === 0) return null;
        const active =
          (kind === 'videoinput' && !local.camOn ? undefined : preferred[kind]) ??
          list[0]?.deviceId;
        return (
          <label key={kind} className="block text-sm">
            <span className="mb-1 block text-slate-300">{t(LABEL[kind])}</span>
            <select
              className="field"
              data-testid={`sel-${kind}`}
              value={active}
              onChange={(e) => void setDevice(kind, e.target.value)}
            >
              {list.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || t(FALLBACK[kind], { n: i + 1 })}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
