/**
 * Lets a reloaded tab rejoin its relay room. The room secret lives in `sessionStorage`: it belongs
 * to this tab only, survives a reload, and is gone when the tab closes (never in localStorage).
 */
const KEY = 'tincan.relay.v1';

export interface ResumeRecord {
  /** base64url room secret */
  secret: string;
  creator: boolean;
}

export function saveResume(record: ResumeRecord): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* private mode: a reload just will not rejoin */
  }
}

export function loadResume(): ResumeRecord | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const { secret, creator } = v as { secret?: unknown; creator?: unknown };
    return typeof secret === 'string' && secret.length === 22 && typeof creator === 'boolean'
      ? { secret, creator }
      : null;
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
