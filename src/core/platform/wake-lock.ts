interface Sentinel extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}
export interface WakeLockEnv {
  wakeLock: { request(type: 'screen'): Promise<Sentinel> } | null;
  visibility: {
    readonly visibilityState: string;
    addEventListener(t: 'visibilitychange', f: () => void): void;
    removeEventListener(t: 'visibilitychange', f: () => void): void;
  } | null;
}

function defaultEnv(): WakeLockEnv {
  const nav =
    typeof navigator === 'undefined'
      ? null
      : (navigator as Navigator & { wakeLock?: WakeLockEnv['wakeLock'] });
  return {
    wakeLock: nav?.wakeLock ?? null,
    visibility: typeof document === 'undefined' ? null : document,
  };
}

/**
 * Keeps the screen on during a call. The browser drops the lock when the page is hidden, so it is
 * requested again on `visibilitychange → visible`. Silently does nothing where unsupported.
 */
export class ScreenWakeLock {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private off: (() => void) | null = null;

  constructor(private readonly env: WakeLockEnv = defaultEnv()) {}

  get supported(): boolean {
    return this.env.wakeLock !== null;
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    const vis = this.env.visibility;
    if (vis && !this.off) {
      const onVisible = () => {
        if (this.wanted && vis.visibilityState === 'visible') void this.request();
      };
      vis.addEventListener('visibilitychange', onVisible);
      this.off = () => vis.removeEventListener('visibilitychange', onVisible);
    }
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    this.off?.();
    this.off = null;
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      /* already released */
    }
  }

  private async request(): Promise<void> {
    if (!this.env.wakeLock || this.active) return;
    try {
      const s = await this.env.wakeLock.request('screen');
      if (!this.wanted) return void s.release().catch(() => undefined);
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch {
      /* denied (e.g. low battery) — not essential */
    }
  }
}
