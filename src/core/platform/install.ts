export interface InstallEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** iOS-only `navigator.standalone`. */
  standaloneFlag: boolean | undefined;
  displayModeStandalone: boolean;
}

export function readInstallEnv(): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standaloneFlag: nav.standalone,
    displayModeStandalone:
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  };
}

/** iPhone/iPad/iPod, including iPadOS which reports itself as a touch-capable Mac. */
export function isIos(env: InstallEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

export function isStandalone(env: InstallEnv): boolean {
  return env.standaloneFlag === true || env.displayModeStandalone;
}

/** iOS has no install prompt, so we explain Share → Add to Home Screen — unless already installed. */
export function shouldShowIosInstallHint(env: InstallEnv, dismissed: boolean): boolean {
  return isIos(env) && !isStandalone(env) && !dismissed;
}

const KEY = 'tincan.iosHintDismissed';

export function iosHintDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissIosHint(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode: the hint simply returns next time */
  }
}
