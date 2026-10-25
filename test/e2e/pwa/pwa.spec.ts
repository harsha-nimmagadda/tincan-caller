import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { devices, expect, test, type Page } from '@playwright/test';
import type { EngineName } from '../browsers';
import {
  type App,
  closeAll,
  connect,
  enterReply,
  expectInCall,
  joinFromLink,
  openApp,
  startAsCaller,
  tid,
} from '../ui/helpers';
import { startServer } from './static-server';

const swReady = (page: Page) =>
  page.evaluate(async () => void (await navigator.serviceWorker.ready));

/** First visit installs the service worker; a reload puts the page under its control. */
async function installShell(page: Page): Promise<void> {
  await swReady(page);
  await page.reload();
  await expect(tid(page, 'start-call')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test('installable: valid manifest, PNG + maskable icons, apple touch icon, no orientation lock', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  try {
    const manifest = await (await a.page.request.get(`${baseURL}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({
      name: 'Tincan',
      short_name: 'Tincan',
      id: './',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#0b0f14',
      theme_color: '#0b0f14',
    });
    expect(manifest.orientation).toBeUndefined();
    const sizes = (manifest.icons as { sizes: string; purpose?: string; type: string }[]).map(
      (i) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      const res = await a.page.request.get(`${baseURL}/${icon.src}`);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    const touch = await a.page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect((await a.page.request.get(new URL(touch ?? '', `${baseURL}/`).href)).status()).toBe(200);
    expect(await a.page.locator('link[rel="manifest"]').count()).toBe(1);

    // Chrome's own verdict on installability (Lighthouse dropped its PWA category).
    const cdp = await a.context.newCDPSession(a.page);
    const app = (await cdp.send('Page.getAppManifest')) as { errors: unknown[] };
    expect(app.errors).toEqual([]);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: unknown[];
    };
    expect(installabilityErrors).toEqual([]);
  } finally {
    await closeAll(a);
  }
});

/**
 * Chromium's offline emulation also blocks its WebRTC sockets (unlike Firefox/WebKit's), which a
 * real offline LAN would not. So for Chromium "offline" means the web server is gone: HTTP fails,
 * local UDP still works. The other engines use Playwright's network emulation.
 */
async function withOfflineCapableApps(
  engine: EngineName,
  baseURL: string,
  body: (a: App, b: App, goOffline: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const server = engine === 'chromium' ? await startServer(resolve('dist-test')) : null;
  const url = server?.url ?? baseURL;
  const a = await openApp(engine, url);
  const b = await openApp(engine, url);
  try {
    await installShell(a.page);
    await installShell(b.page);
    await body(a, b, async () => {
      if (server) await server.close();
      else await Promise.all([a.context.setOffline(true), b.context.setOffline(true)]);
    });
  } finally {
    await closeAll(a, b);
    await server?.close().catch(() => undefined);
  }
}

for (const engine of ['chromium', 'firefox', 'webkit'] as EngineName[]) {
  test(`8. offline (${engine}): the app shell loads with no network, and two offline devices still connect`, async ({
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await withOfflineCapableApps(engine, baseURL ?? '', async (a, b, goOffline) => {
      await goOffline();
      await a.page.reload(); // served entirely from the precache
      await expect(tid(a.page, 'start-call')).toBeVisible();
      await connect(a.page, b.page); // loopback/LAN candidates only
    });
  });
}

test('offline indicator: shown with no network, hidden again when back online (not during a call)', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  try {
    await installShell(a.page);
    await expect(tid(a.page, 'offline-badge')).toHaveCount(0);
    await a.context.setOffline(true);
    await expect(tid(a.page, 'offline-badge')).toBeVisible();
    await a.page.reload();
    await expect(tid(a.page, 'start-call')).toBeVisible();
    await expect(tid(a.page, 'offline-badge')).toBeVisible();
    await a.context.setOffline(false);
    await expect(tid(a.page, 'offline-badge')).toHaveCount(0);
  } finally {
    await closeAll(a);
  }
});

test('offline: the QR scanner worker is precached too (scan a picture with no network)', async ({
  baseURL,
}) => {
  test.setTimeout(120_000);
  await withOfflineCapableApps('firefox', baseURL ?? '', async (a, b, goOffline) => {
    await startAsCaller(a.page);
    const qr = await tid(a.page, 'invite-qr').screenshot();
    await goOffline();
    await b.page.reload();
    await tid(b.page, 'join-toggle').click();
    await tid(b.page, 'join-scan').click();
    await tid(b.page, 'qr-upload').setInputFiles({
      name: 'q.png',
      mimeType: 'image/png',
      buffer: qr,
    });
    await expect(tid(b.page, 'lobby-continue')).toBeVisible({ timeout: 15_000 });
  });
});

for (const engine of ['chromium', 'firefox', 'webkit'] as EngineName[]) {
  test(`CSP (${engine}): a full call, QR scan, settings and About raise no violations`, async ({
    baseURL,
  }) => {
    const a = await openApp(engine, baseURL ?? '');
    const b = await openApp(engine, baseURL ?? '');
    try {
      for (const app of [a, b]) {
        await app.context.addInitScript(() => {
          (window as unknown as { __csp: string[] }).__csp = [];
          document.addEventListener('securitypolicyviolation', (e) =>
            (window as unknown as { __csp: string[] }).__csp.push(
              `${e.violatedDirective} ${e.blockedURI}`,
            ),
          );
        });
        await app.page.reload();
      }
      const meta = await a.page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content');
      expect(meta).toContain("default-src 'self'");
      expect(meta).toContain("script-src 'self'");
      expect(meta).toContain("object-src 'none'");
      expect(meta).toContain("base-uri 'none'");

      await tid(a.page, 'open-settings').click();
      await tid(a.page, 'settings-back').click();
      await tid(a.page, 'open-about').click();
      await tid(a.page, 'about-back').click();

      const invite = await startAsCaller(a.page);
      const qr = await tid(a.page, 'invite-qr').screenshot();
      await tid(b.page, 'join-toggle').click();
      await tid(b.page, 'join-scan').click(); // starts the worker (worker-src) and the camera scanner
      await tid(b.page, 'qr-upload').setInputFiles({
        name: 'q.png',
        mimeType: 'image/png',
        buffer: qr,
      });
      await expect(tid(b.page, 'lobby-continue')).toBeVisible({ timeout: 15_000 });
      expect(invite.link).toBeTruthy();
      await tid(b.page, 'lobby-continue').click();
      await expect(tid(b.page, 'reply-qr')).toBeVisible({ timeout: 15_000 });
      await enterReply(a.page, await tid(b.page, 'reply-code').inputValue());
      await expectInCall(a.page, b.page);
      await a.page.waitForTimeout(1500);

      for (const p of [a.page, b.page]) {
        expect(await p.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual(
          [],
        );
      }
    } finally {
      await closeAll(a, b);
    }
  });
}

test('frame-busting: inside another page the app shows only a link out and starts nothing', async ({
  baseURL,
}) => {
  // A real second origin (another loopback port) embeds the app, like a clickjacking page would.
  const { createServer } = await import('node:http');
  const embedder = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<iframe id="f" src="${baseURL}/?fake=1" width="600" height="800"></iframe>`);
  });
  await new Promise<void>((resolve) => embedder.listen(0, '127.0.0.1', resolve));
  const addr = embedder.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const a = await openApp('chromium', baseURL ?? '');
  try {
    await a.page.goto(`http://127.0.0.1:${port}/`);
    const frame = a.page.frameLocator('#f');
    await expect(frame.getByTestId('frame-blocked')).toBeVisible();
    await expect(frame.getByTestId('frame-open')).toHaveAttribute('href', /localhost/);
    await expect(frame.getByTestId('start-call')).toHaveCount(0);
    await expect(frame.getByTestId('join-toggle')).toHaveCount(0);
  } finally {
    await closeAll(a);
    await new Promise((resolve) => embedder.close(resolve));
  }
});

test('iOS install hint: shown on iPhone Safari until dismissed or installed; absent elsewhere', async ({
  browser,
  baseURL,
}) => {
  void browser;
  const ios = await openApp('webkit', baseURL ?? '');
  await ios.context.close();
  const ctx = await ios.browser.newContext({ ...devices['iPhone 15'] });
  const page = await ctx.newPage();
  try {
    await page.goto(`${baseURL}/?fake=1`);
    await expect(tid(page, 'ios-install-hint')).toBeVisible();
    await tid(page, 'ios-install-dismiss').click();
    await expect(tid(page, 'ios-install-hint')).toHaveCount(0);
    await page.reload();
    await expect(tid(page, 'start-call')).toBeVisible();
    await expect(tid(page, 'ios-install-hint')).toHaveCount(0);

    const installed = await ios.browser.newContext({ ...devices['iPhone 15'] });
    await installed.addInitScript(() =>
      Object.defineProperty(navigator, 'standalone', { value: true }),
    );
    const p2 = await installed.newPage();
    await p2.goto(`${baseURL}/?fake=1`);
    await expect(tid(p2, 'start-call')).toBeVisible();
    await expect(tid(p2, 'ios-install-hint')).toHaveCount(0); // already on the Home Screen
  } finally {
    await ios.browser.close();
  }
  const desktop = await openApp('chromium', baseURL ?? '');
  try {
    await expect(tid(desktop.page, 'start-call')).toBeVisible();
    await expect(tid(desktop.page, 'ios-install-hint')).toHaveCount(0);
  } finally {
    await closeAll(desktop);
  }
});

test('token hygiene: no tokens in URLs sent, referrers, logs or storage; fragments are stripped', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  const logs: string[] = [];
  const requests: { url: string; referer: string | undefined }[] = [];
  for (const app of [a, b]) {
    app.page.on('console', (m) => logs.push(m.text()));
    app.page.on('request', (r) => requests.push({ url: r.url(), referer: r.headers()['referer'] }));
  }
  try {
    const invite = await startAsCaller(a.page);
    const reply = await joinFromLink(b.page, invite.link);
    await enterReply(a.page, reply.link);
    await expectInCall(a.page, b.page);
    await a.page.waitForTimeout(1000);

    const secrets = [invite.code.slice(8, 48), reply.code.slice(8, 48)];
    for (const s of secrets) {
      expect(
        logs.some((l) => l.includes(s)),
        'console',
      ).toBe(false);
      expect(
        requests.some((r) => r.url.includes(s)),
        'request URL',
      ).toBe(false);
    }
    expect(
      requests.every((r) => !r.url.includes('#')),
      'fragments never go on the wire',
    ).toBe(true);
    expect(
      requests.filter((r) => r.referer),
      'no Referer header',
    ).toEqual([]);
    for (const p of [a.page, b.page]) {
      expect(new URL(p.url()).hash).toBe('');
      const stored = await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      for (const s of secrets) expect(stored).not.toContain(s);
      expect(await p.evaluate(() => Object.keys(localStorage))).toEqual(['tincan.settings.v1']);
    }
  } finally {
    await closeAll(a, b);
  }
});

test.describe('update flow', () => {
  const dirs = { a: resolve('dist-update-a'), b: resolve('dist-update-b') };

  test.beforeAll(() => {
    test.setTimeout(240_000);
    const build = (outDir: string, version: string) =>
      execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'test'], {
        env: { ...process.env, TINCAN_OUT_DIR: outDir, TINCAN_VERSION: version },
        stdio: 'ignore',
      });
    build(dirs.a, '1.0.0-a');
    build(dirs.b, '2.0.0-b');
  });

  test('a deployed update never reloads a call; it is offered after hangup and applied on Reload', async () => {
    test.setTimeout(180_000);
    const server = await startServer(dirs.a);
    const a = await openApp('chromium', server.url);
    const b = await openApp('chromium', server.url);
    try {
      await installShell(a.page); // a returning visitor: the page is under the service worker's control
      await connect(a.page, b.page);
      await a.page.evaluate(
        () => ((window as unknown as { __marker: string }).__marker = 'same-page'),
      );

      server.serve(dirs.b); // "deploy build B"
      await a.page.evaluate(
        async () => void (await (await navigator.serviceWorker.getRegistration())?.update()),
      );
      await expect
        .poll(() =>
          a.page.evaluate(
            async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
          ),
        )
        .toBe(true); // the new version is downloaded and waiting
      await a.page.waitForTimeout(2000);

      // Mid-call: no prompt, no reload, call intact.
      await expect(tid(a.page, 'update-prompt')).toHaveCount(0);
      expect(
        await a.page.evaluate(() => (window as unknown as { __marker?: string }).__marker),
      ).toBe('same-page');
      await expect(tid(a.page, 'call-state')).toHaveAttribute('data-state', 'connected');

      await tid(a.page, 'btn-hangup').click();
      await expect(tid(a.page, 'update-prompt')).toBeVisible({ timeout: 10_000 });
      expect(
        await a.page.evaluate(() => (window as unknown as { __marker?: string }).__marker),
      ).toBe('same-page');

      // Reload is the person's choice: the page navigates and the new version takes over.
      await Promise.all([a.page.waitForEvent('load'), tid(a.page, 'update-reload').click()]);
      expect(
        await a.page.evaluate(() => (window as unknown as { __marker?: string }).__marker),
      ).toBeUndefined();
      await expect(tid(a.page, 'start-call')).toBeVisible();
      await tid(a.page, 'open-about').click();
      await expect(tid(a.page, 'app-version')).toHaveText('2.0.0-b');
    } finally {
      await closeAll(a, b);
      await server.close();
    }
  });
});
