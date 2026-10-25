import { expect, type Page } from '@playwright/test';
import type { EngineName } from '../browsers';
import { openApp, tid, withFake, type App } from '../ui/helpers';

/** An app whose Settings point at the mock relay (and nothing else), with relays switched on or off. */
export function openRelayApp(
  engine: EngineName,
  baseURL: string,
  relayUrl: string,
  opts: { relayEnabled?: boolean; relays?: string[] } = {},
): Promise<App> {
  return openApp(engine, baseURL, {
    settings: { relayEnabled: opts.relayEnabled ?? true, relays: opts.relays ?? [relayUrl] },
  });
}

/** Creator: Start a call → (relay mode is the default when enabled) → Continue → shareable link. */
export async function startRelayCall(page: Page): Promise<string> {
  await tid(page, 'start-call').click();
  await expect(tid(page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
  await expect(tid(page, 'mode-relay')).toBeChecked();
  await tid(page, 'lobby-continue').click();
  await expect(tid(page, 'relay-qr')).toBeVisible({ timeout: 15_000 });
  return (await tid(page, 'relay-qr').getAttribute('data-link')) ?? '';
}

/** Opener: follow the link → lobby → Continue. */
export async function joinRelayLink(page: Page, link: string): Promise<void> {
  await page.goto(withFake(link));
  await expect(tid(page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
  await tid(page, 'lobby-continue').click();
}

export async function expectConnectedBoth(a: Page, b: Page, timeout = 40_000): Promise<void> {
  for (const p of [a, b]) {
    await expect(tid(p, 'call-state')).toHaveAttribute('data-state', 'connected', { timeout });
    await expect(tid(p, 'remote-video')).toBeVisible();
  }
}
