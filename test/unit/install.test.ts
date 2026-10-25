import { describe, expect, it } from 'vitest';
import {
  isIos,
  isStandalone,
  shouldShowIosInstallHint,
  type InstallEnv,
} from '../../src/core/platform/install';

const env = (over: Partial<InstallEnv>): InstallEnv => ({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
  platform: 'Linux x86_64',
  maxTouchPoints: 0,
  standaloneFlag: undefined,
  displayModeStandalone: false,
  ...over,
});
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';

describe('iOS install hint', () => {
  it('detects iPhone, iPad and iPadOS-as-Mac, but not desktop or Android', () => {
    expect(isIos(env({ userAgent: IPHONE }))).toBe(true);
    expect(isIos(env({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }))).toBe(true);
    expect(
      isIos(
        env({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        }),
      ),
    ).toBe(true);
    expect(
      isIos(
        env({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'MacIntel',
          maxTouchPoints: 0,
        }),
      ),
    ).toBe(false);
    expect(isIos(env({}))).toBe(false);
    expect(isIos(env({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' }))).toBe(
      false,
    );
  });
  it('knows when it is already installed', () => {
    expect(isStandalone(env({ standaloneFlag: true }))).toBe(true);
    expect(isStandalone(env({ displayModeStandalone: true }))).toBe(true);
    expect(isStandalone(env({ standaloneFlag: false }))).toBe(false);
  });
  it('shows only on iOS, not installed, not dismissed', () => {
    expect(shouldShowIosInstallHint(env({ userAgent: IPHONE }), false)).toBe(true);
    expect(shouldShowIosInstallHint(env({ userAgent: IPHONE }), true)).toBe(false);
    expect(shouldShowIosInstallHint(env({ userAgent: IPHONE, standaloneFlag: true }), false)).toBe(
      false,
    );
    expect(shouldShowIosInstallHint(env({}), false)).toBe(false);
  });
});
