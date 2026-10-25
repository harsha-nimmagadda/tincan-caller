import type { LaunchOptions } from '@playwright/test';

export type EngineName = 'chromium' | 'firefox' | 'webkit';

/** Shared by playwright.config.ts and the two-browser call tests. */
export const launchOptions: Record<EngineName, LaunchOptions> = {
  chromium: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      // Loopback candidates keep calls deterministic in CI and when the network is emulated offline.
      '--allow-loopback-in-peer-connection',
    ],
  },
  firefox: {
    firefoxUserPrefs: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
      'media.peerconnection.ice.obfuscate_host_addresses': false,
      'media.peerconnection.ice.loopback': true,
    },
  },
  webkit: {},
};
