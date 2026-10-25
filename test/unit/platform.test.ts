import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../../src/core/platform/capabilities';
import { copyText, readText } from '../../src/core/platform/clipboard';
import { bindCallActions, setMediaSessionState } from '../../src/core/platform/media-session';
import { isMobileDevice, isPortrait } from '../../src/core/platform/orientation';
import { enableAutoPip, enterPip, exitPip, pipSupported } from '../../src/core/platform/pip';
import { shareLink } from '../../src/core/platform/share';
import { ScreenWakeLock, type WakeLockEnv } from '../../src/core/platform/wake-lock';

afterEach(() => vi.unstubAllGlobals());

// ---------------- wake lock ----------------
function wakeEnv() {
  const listeners = new Set<() => void>();
  const sentinels: (EventTarget & { released: boolean; release: () => Promise<void> })[] = [];
  const env = {
    wakeLock: {
      request: vi.fn(async () => {
        const s = Object.assign(new EventTarget(), {
          released: false,
          release: async () => {
            s.released = true;
            s.dispatchEvent(new Event('release'));
          },
        });
        sentinels.push(s);
        return s;
      }),
    },
    visibility: {
      visibilityState: 'visible',
      addEventListener: (_t: string, f: () => void) => void listeners.add(f),
      removeEventListener: (_t: string, f: () => void) => void listeners.delete(f),
    },
  };
  return { env: env as unknown as WakeLockEnv & typeof env, listeners, sentinels };
}

describe('ScreenWakeLock', () => {
  it('requests a screen lock and releases it', async () => {
    const { env, sentinels } = wakeEnv();
    const w = new ScreenWakeLock(env);
    await w.acquire();
    expect(env.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(w.active).toBe(true);
    await w.release();
    expect(sentinels[0]?.released).toBe(true);
    expect(w.active).toBe(false);
  });
  it('does not stack requests while a lock is held', async () => {
    const { env } = wakeEnv();
    const w = new ScreenWakeLock(env);
    await w.acquire();
    await w.acquire();
    expect(env.wakeLock.request).toHaveBeenCalledOnce();
  });
  it('re-requests when the page becomes visible after the system dropped the lock', async () => {
    const { env, listeners, sentinels } = wakeEnv();
    const w = new ScreenWakeLock(env);
    await w.acquire();
    await sentinels[0]?.release(); // the browser releases it when the tab is hidden
    expect(w.active).toBe(false);
    listeners.forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    expect(env.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(w.active).toBe(true);
  });
  it('after release() it stops re-requesting and drops its listener', async () => {
    const { env, listeners } = wakeEnv();
    const w = new ScreenWakeLock(env);
    await w.acquire();
    await w.release();
    expect(listeners.size).toBe(0);
    await w.release();
  });
  it('a lock granted after release() is dropped immediately', async () => {
    const { env, sentinels } = wakeEnv();
    let resolve: (v: unknown) => void = () => undefined;
    env.wakeLock.request = vi.fn(() => new Promise((r) => (resolve = r))) as never;
    const w = new ScreenWakeLock(env);
    const p = w.acquire();
    await w.release();
    const late = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(async () => undefined),
    });
    resolve(late);
    await p;
    expect(late.release).toHaveBeenCalled();
    expect(w.active).toBe(false);
    expect(sentinels).toHaveLength(0);
  });
  it('is a silent no-op when unsupported or denied', async () => {
    const none = new ScreenWakeLock({ wakeLock: null, visibility: null });
    expect(none.supported).toBe(false);
    await expect(none.acquire()).resolves.toBeUndefined();
    const { env } = wakeEnv();
    env.wakeLock.request = vi.fn(async () => {
      throw new DOMException('low battery', 'NotAllowedError');
    }) as never;
    await expect(new ScreenWakeLock(env).acquire()).resolves.toBeUndefined();
  });
});

// ---------------- media session ----------------
describe('media session', () => {
  it('binds mic / camera / hangup and unbinds them', () => {
    const handlers = new Map<string, (() => void) | null>();
    vi.stubGlobal('navigator', {
      mediaSession: {
        setActionHandler: (a: string, h: (() => void) | null) => void handlers.set(a, h),
      },
    });
    const calls: string[] = [];
    const off = bindCallActions({
      toggleMic: () => calls.push('mic'),
      toggleCam: () => calls.push('cam'),
      hangup: () => calls.push('hangup'),
    });
    handlers.get('togglemicrophone')?.();
    handlers.get('togglecamera')?.();
    handlers.get('hangup')?.();
    expect(calls).toEqual(['mic', 'cam', 'hangup']);
    off();
    expect([...handlers.values()].every((h) => h === null)).toBe(true);
  });
  it('tolerates actions the browser does not support', () => {
    const handlers = new Map<string, (() => void) | null>();
    vi.stubGlobal('navigator', {
      mediaSession: {
        setActionHandler: (a: string, h: (() => void) | null) => {
          if (a === 'togglecamera') throw new TypeError('unsupported');
          handlers.set(a, h);
        },
      },
    });
    const off = bindCallActions({
      toggleMic: () => undefined,
      toggleCam: () => undefined,
      hangup: () => undefined,
    });
    expect([...handlers.keys()].sort()).toEqual(['hangup', 'togglemicrophone']);
    expect(() => off()).not.toThrow();
  });
  it('reports mic/cam state, and survives missing APIs', () => {
    const spy = {
      setMicrophoneActive: vi.fn(),
      setCameraActive: vi.fn(),
      setActionHandler: vi.fn(),
    };
    vi.stubGlobal('navigator', { mediaSession: spy });
    setMediaSessionState({ mic: true, cam: false });
    expect(spy.setMicrophoneActive).toHaveBeenCalledWith(true);
    expect(spy.setCameraActive).toHaveBeenCalledWith(false);
    vi.stubGlobal('navigator', {});
    expect(() => setMediaSessionState({ mic: true, cam: true })).not.toThrow();
    expect(() =>
      bindCallActions({
        toggleMic: () => undefined,
        toggleCam: () => undefined,
        hangup: () => undefined,
      })(),
    ).not.toThrow();
  });
});

// ---------------- picture in picture ----------------
function fakeVideo() {
  const attrs = new Map<string, string>();
  return Object.assign(
    {},
    {
      requestPictureInPicture: vi.fn(async () => undefined),
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
      attrs,
    },
  ) as unknown as HTMLVideoElement & {
    attrs: Map<string, string>;
    requestPictureInPicture: ReturnType<typeof vi.fn>;
    autoPictureInPicture?: boolean;
  };
}

describe('picture in picture', () => {
  it('is shown only where supported', () => {
    vi.stubGlobal('document', {});
    expect(pipSupported()).toBe(false);
    vi.stubGlobal('document', { pictureInPictureEnabled: true });
    expect(pipSupported()).toBe(true);
    const safari = {
      webkitSupportsPresentationMode: (m: string) => m === 'picture-in-picture',
    } as unknown as HTMLVideoElement;
    vi.stubGlobal('document', {});
    expect(pipSupported(safari)).toBe(true);
  });
  it('enters via the standard API, falls back to the WebKit one, and fails soft', async () => {
    vi.stubGlobal('document', { pictureInPictureEnabled: true });
    const v = fakeVideo();
    expect(await enterPip(v)).toBe(true);
    expect(v.requestPictureInPicture).toHaveBeenCalled();
    v.requestPictureInPicture.mockRejectedValueOnce(new DOMException('gesture', 'NotAllowedError'));
    expect(await enterPip(v)).toBe(false);
    vi.stubGlobal('document', {});
    const webkit = Object.assign(fakeVideo(), { webkitSetPresentationMode: vi.fn() });
    expect(await enterPip(webkit)).toBe(true);
    expect(webkit.webkitSetPresentationMode).toHaveBeenCalledWith('picture-in-picture');
    expect(await enterPip(fakeVideo())).toBe(false);
  });
  it('exits PiP', async () => {
    const exit = vi.fn(async () => undefined);
    vi.stubGlobal('document', { pictureInPictureElement: {}, exitPictureInPicture: exit });
    await exitPip();
    expect(exit).toHaveBeenCalled();
    const webkit = { webkitSetPresentationMode: vi.fn() } as unknown as HTMLVideoElement;
    vi.stubGlobal('document', {});
    await exitPip(webkit);
    expect(
      (webkit as unknown as { webkitSetPresentationMode: ReturnType<typeof vi.fn> })
        .webkitSetPresentationMode,
    ).toHaveBeenCalledWith('inline');
  });
  it('auto-PiP: Safari attribute + Chrome media-session action, both undone on cleanup', () => {
    vi.stubGlobal('document', { pictureInPictureEnabled: true });
    const handlers = new Map<string, (() => void) | null>();
    vi.stubGlobal('navigator', {
      mediaSession: {
        setActionHandler: (a: string, h: (() => void) | null) => void handlers.set(a, h),
      },
    });
    const v = fakeVideo();
    const off = enableAutoPip(v);
    expect(v.attrs.has('autopictureinpicture')).toBe(true);
    expect(v.autoPictureInPicture).toBe(true);
    handlers.get('enterpictureinpicture')?.();
    expect(v.requestPictureInPicture).toHaveBeenCalled();
    off();
    expect(v.attrs.has('autopictureinpicture')).toBe(false);
    expect(handlers.get('enterpictureinpicture')).toBeNull();
  });
  it('auto-PiP tolerates browsers without the action', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {
      mediaSession: {
        setActionHandler: () => {
          throw new TypeError('unsupported');
        },
      },
    });
    const off = enableAutoPip(fakeVideo());
    expect(() => off()).not.toThrow();
  });
});

// ---------------- clipboard & share ----------------
function stubDom(execCommand: () => boolean) {
  const area = {
    value: '',
    style: { cssText: '' },
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(execCommand),
  };
  vi.stubGlobal('document', doc);
  return { area, doc };
}

describe('clipboard', () => {
  it('uses the async clipboard API when it works', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hello')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
  });
  it('falls back to a selected textarea + execCommand', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    const { area, doc } = stubDom(() => true);
    expect(await copyText('hello')).toBe('copied');
    expect(area.value).toBe('hello');
    expect(area.select).toHaveBeenCalled();
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalled();
  });
  it("returns 'manual' when nothing works, so the UI can show its visible textarea", async () => {
    vi.stubGlobal('navigator', {});
    stubDom(() => false);
    expect(await copyText('x')).toBe('manual');
    stubDom(() => {
      throw new Error('nope');
    });
    expect(await copyText('x')).toBe('manual');
  });
  it('readText returns null when unavailable or denied', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => 'pasted' } });
    expect(await readText()).toBe('pasted');
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    expect(await readText()).toBeNull();
    vi.stubGlobal('navigator', {});
    expect(await readText()).toBeNull();
  });
});

describe('share', () => {
  const data = { title: 't', text: 'x', url: 'https://u/#o=abc' };
  it('uses the native share sheet', async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share });
    expect(await shareLink(data)).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
  });
  it('a dismissed share sheet is "cancelled", not an error and not a copy', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new DOMException('closed', 'AbortError');
      },
      clipboard: { writeText },
    });
    expect(await shareLink(data)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('falls back to copying the link without Web Share, or when sharing breaks', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareLink(data)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new TypeError('bad');
      },
      clipboard: { writeText },
    });
    expect(await shareLink(data)).toBe('copied');
  });
});

// ---------------- orientation & capabilities ----------------
describe('orientation', () => {
  it('prefers screen.orientation, then matchMedia, then viewport shape', () => {
    vi.stubGlobal('window', { innerWidth: 100, innerHeight: 50 });
    vi.stubGlobal('screen', { orientation: { type: 'portrait-primary' } });
    expect(isPortrait()).toBe(true);
    vi.stubGlobal('screen', { orientation: { type: 'landscape-primary' } });
    expect(isPortrait()).toBe(false);
    vi.stubGlobal('screen', {});
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
      innerWidth: 100,
      innerHeight: 50,
    });
    expect(isPortrait()).toBe(true);
    vi.stubGlobal('window', { innerWidth: 100, innerHeight: 200 });
    expect(isPortrait()).toBe(true);
    vi.stubGlobal('window', { innerWidth: 200, innerHeight: 100 });
    expect(isPortrait()).toBe(false);
  });
  it('touch devices count as mobile', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(isMobileDevice()).toBe(true);
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    expect(isMobileDevice()).toBe(false);
  });
});

describe('capabilities', () => {
  it('feature-detects each API independently', () => {
    vi.stubGlobal('navigator', {
      wakeLock: {},
      share: () => undefined,
      clipboard: { readText: () => undefined },
      mediaDevices: { getUserMedia: () => undefined },
    });
    vi.stubGlobal('document', { pictureInPictureEnabled: true });
    expect(detectCapabilities()).toMatchObject({
      wakeLock: true,
      pip: true,
      share: true,
      clipboardRead: true,
      getUserMedia: true,
      sinkId: false,
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {});
    expect(detectCapabilities()).toMatchObject({
      wakeLock: false,
      pip: false,
      share: false,
      clipboardRead: false,
      getUserMedia: false,
    });
  });
});
