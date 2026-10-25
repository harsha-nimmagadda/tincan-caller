import { chromium, expect, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { launchOptions, type EngineName } from '../browsers';

const engines = { chromium, firefox, webkit } as const;

export interface Party {
  browser: Browser;
  page: Page;
}

export async function openHarness(
  engine: EngineName,
  baseURL: string,
  query = 'fake=1',
): Promise<Party> {
  const browser = await engines[engine].launch(launchOptions[engine]);
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log(`[${engine}] pageerror: ${e.message}`));
  await page.goto(`${baseURL}/src/debug.html?${query}`);
  return { browser, page };
}

export const tid = (page: Page, id: string) => page.getByTestId(id);

/** Runs the whole manual handshake: A invites (as a link), B joins, A pastes the reply. */
export async function handshake(a: Page, b: Page): Promise<{ invite: string; reply: string }> {
  await tid(a, 'start-call').click();
  await expect(tid(a, 'invite-link')).not.toHaveValue('', { timeout: 15_000 });
  const invite = await tid(a, 'invite-link').inputValue();
  expect(invite).toContain('#o=');
  expect(invite).not.toContain('?o=');

  await tid(b, 'offer-input').fill(`Join my call: ${invite} (thanks!)`);
  await tid(b, 'join-submit').click();
  await expect(tid(b, 'reply-code')).not.toHaveValue('', { timeout: 15_000 });
  const reply = await tid(b, 'reply-code').inputValue();

  await tid(a, 'reply-input').fill(reply);
  await tid(a, 'reply-submit').click();
  return { invite, reply };
}

export async function expectConnected(...pages: Page[]): Promise<void> {
  for (const p of pages) {
    await expect(tid(p, 'call-state')).toHaveText('connected', { timeout: 30_000 });
  }
}

/** Remote video has decoded frames and its clock keeps advancing. */
export async function expectRemoteVideoPlaying(page: Page): Promise<void> {
  const sample = () =>
    page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]');
      return v ? { w: v.videoWidth, t: v.currentTime } : { w: 0, t: 0 };
    });
  await expect.poll(async () => (await sample()).w, { timeout: 20_000 }).toBeGreaterThan(0);
  const first = (await sample()).t;
  await expect.poll(async () => (await sample()).t, { timeout: 10_000 }).toBeGreaterThan(first);
}

export async function expectSameSas(a: Page, b: Page): Promise<void> {
  await expect(tid(a, 'sas-code')).toHaveText(/^\d{3} \d{3}$/, { timeout: 10_000 });
  const code = await tid(a, 'sas-code').textContent();
  await expect(tid(b, 'sas-code')).toHaveText(code ?? '');
}

export async function closeAll(...parties: Party[]): Promise<void> {
  await Promise.all(parties.map((p) => p.browser.close()));
}

interface Debug {
  status: string;
  connectionState: string;
  ctlState: string;
  activeTimers: number;
  activeListeners: number;
  liveLocalTracks: number;
  videoLive: boolean;
  videoMaxBitrate: number | null;
}
export const debugInfo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tincan: { debug(): Debug } }).__tincan.debug());
