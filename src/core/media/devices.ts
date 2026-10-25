export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceEntry {
  deviceId: string;
  /** Empty until the user has granted permission. */
  label: string;
}

export type DeviceLists = Record<DeviceKind, DeviceEntry[]>;

export const EMPTY_DEVICES: DeviceLists = { audioinput: [], videoinput: [], audiooutput: [] };

interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label: string;
}

export function parseDevices(infos: readonly DeviceInfoLike[]): DeviceLists {
  const out: DeviceLists = { audioinput: [], videoinput: [], audiooutput: [] };
  for (const d of infos) {
    if (d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput') {
      out[d.kind].push({ deviceId: d.deviceId, label: d.label });
    }
  }
  return out;
}

/** Speaker selection exists only where `setSinkId` does (not iOS Safari / Firefox Android). */
export function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export async function applySink(
  el: HTMLMediaElement,
  deviceId: string | undefined,
): Promise<boolean> {
  if (!supportsSinkId() || !deviceId) return false;
  try {
    await (el as HTMLMediaElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
    return true;
  } catch {
    return false;
  }
}
