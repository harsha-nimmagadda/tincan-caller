import {
  chromium,
  expect,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { launchOptions, type EngineName } from '../browsers';

const engines = { chromium, firefox, webkit } as const;

export interface App {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  engine: EngineName;
}

const SETTINGS_KEY = 'tincan.settings.v1';

/** Launches `engine` and opens the real app with fake cameras (`fake=1`) and no STUN (LAN only, deterministic). */
export async function openApp(
  engine: EngineName,
  baseURL: string,
  opts: { query?: string; settings?: Record<string, unknown> } = {},
): Promise<App> {
  const browser = await engines[engine].launch(launchOptions[engine]);
  const context = await browser.newContext();
  const settings = { stun: [], ...opts.settings };
  await context.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key as string))
        localStorage.setItem(key as string, value as string);
    },
    [SETTINGS_KEY, JSON.stringify(settings)],
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${engine}] pageerror: ${e.message}`));
  await page.goto(`${baseURL}/?${opts.query ?? 'fake=1'}`);
  return { browser, context, page, engine };
}

export const tid = (page: Page, id: string) => page.getByTestId(id);

/** A invite links drop the query string, so tests re-add `fake=1` to the B side's URL. */
export const withFake = (link: string, query = 'fake=1') => link.replace('#', `?${query}#`);

export async function startAsCaller(
  page: Page,
  opts: { audioOnly?: boolean } = {},
): Promise<{ link: string; code: string }> {
  await tid(page, 'start-call').click();
  await expect(tid(page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
  if (opts.audioOnly) await tid(page, 'audio-only-switch').check();
  await tid(page, 'lobby-continue').click();
  await expect(tid(page, 'invite-qr')).toBeVisible({ timeout: 15_000 });
  const link = (await tid(page, 'invite-qr').getAttribute('data-link')) ?? '';
  const code = await tid(page, 'invite-code').inputValue();
  return { link, code };
}

/** B opens the invite link in a fresh page, passes the lobby, and returns the reply. */
export async function joinFromLink(
  page: Page,
  link: string,
  query = 'fake=1',
): Promise<{ link: string; code: string }> {
  await page.goto(withFake(link, query));
  return finishJoin(page);
}

export async function finishJoin(page: Page): Promise<{ link: string; code: string }> {
  await expect(tid(page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
  await tid(page, 'lobby-continue').click();
  await expect(tid(page, 'reply-qr')).toBeVisible({ timeout: 15_000 });
  return {
    link: (await tid(page, 'reply-qr').getAttribute('data-link')) ?? '',
    code: await tid(page, 'reply-code').inputValue(),
  };
}

export async function enterReply(page: Page, text: string): Promise<void> {
  await tid(page, 'reply-input').fill(text);
}

export async function expectInCall(...pages: Page[]): Promise<void> {
  for (const p of pages) {
    await expect(tid(p, 'call-state')).toHaveAttribute('data-state', 'connected', {
      timeout: 30_000,
    });
    await expect(tid(p, 'remote-video')).toBeVisible();
  }
}

export async function expectSameSafetyCode(a: Page, b: Page): Promise<void> {
  for (const p of [a, b]) await tid(p, 'sas-badge').click();
  await expect(tid(a, 'sas-code')).toHaveText(/^\d{3} \d{3}$/, { timeout: 10_000 });
  const code = (await tid(a, 'sas-code').textContent()) ?? '';
  await expect(tid(b, 'sas-code')).toHaveText(code);
  for (const p of [a, b]) await p.keyboard.press('Escape');
  await expect(tid(a, 'safety-dialog')).toBeHidden();
}

/** Full happy path between two apps: A invites by link, B replies by link. */
export async function connect(
  a: Page,
  b: Page,
  opts: { audioOnlyA?: boolean } = {},
): Promise<void> {
  const invite = await startAsCaller(a, { audioOnly: opts.audioOnlyA === true });
  const reply = await joinFromLink(b, invite.link);
  await enterReply(a, reply.link);
  await expectInCall(a, b);
}

export async function closeAll(...apps: App[]): Promise<void> {
  await Promise.all(apps.map((x) => x.browser.close()));
}

export async function remoteVideoState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid="remote-video"]');
    return v ? { w: v.videoWidth, t: v.currentTime } : { w: 0, t: 0 };
  });
}

export async function expectRemoteVideoPlaying(page: Page): Promise<void> {
  await expect
    .poll(async () => (await remoteVideoState(page)).w, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const first = (await remoteVideoState(page)).t;
  await expect
    .poll(async () => (await remoteVideoState(page)).t, { timeout: 10_000 })
    .toBeGreaterThan(first);
}
