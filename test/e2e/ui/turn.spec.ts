import { expect, test } from '@playwright/test';
import { closeAll, enterReply, joinFromLink, openApp, startAsCaller, tid } from './helpers';

const BOGUS = { urls: 'turn:127.0.0.1:9', username: 'u', credential: 'p', enabled: true };

test('Settings: TURN editor — add, Test reports failure for a dead server, force relay needs an enabled server', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  try {
    await tid(a.page, 'open-settings').click();
    await expect(tid(a.page, 'turn-warning')).toContainText('unencrypted');
    await expect(tid(a.page, 'force-relay')).toBeDisabled();
    await tid(a.page, 'turn-add').click();
    await expect(tid(a.page, 'turn-test')).toBeDisabled(); // no address yet
    await tid(a.page, 'turn-urls').fill('turn:127.0.0.1:9');
    await tid(a.page, 'turn-username').fill('u');
    await tid(a.page, 'turn-credential').fill('p');
    await expect(tid(a.page, 'force-relay')).toBeEnabled();
    await tid(a.page, 'force-relay').check();
    await tid(a.page, 'turn-test').click();
    await expect(tid(a.page, 'turn-result')).toHaveAttribute('data-state', 'fail', {
      timeout: 15_000,
    });
    const stored = await a.page.evaluate(() =>
      JSON.parse(localStorage.getItem('tincan.settings.v1') ?? '{}'),
    );
    expect(stored.turn).toEqual([BOGUS]);
    expect(stored.forceRelay).toBe(true);

    await tid(a.page, 'turn-remove').click(); // no TURN left → force relay switches itself off
    await expect(tid(a.page, 'force-relay')).toBeDisabled();
    const after = await a.page.evaluate(() =>
      JSON.parse(localStorage.getItem('tincan.settings.v1') ?? '{}'),
    );
    expect(after.forceRelay).toBe(false);
  } finally {
    await closeAll(a);
  }
});

test('a dead TURN server with force relay: the call fails and the screen says the TURN server did not respond', async ({
  baseURL,
}) => {
  const settings = { turn: [BOGUS], forceRelay: true };
  const a = await openApp('chromium', baseURL ?? '', { settings });
  const b = await openApp('chromium', baseURL ?? '', { settings });
  try {
    const invite = await startAsCaller(a.page);
    const reply = await joinFromLink(b.page, invite.link);
    await enterReply(a.page, reply.link);
    await expect(tid(a.page, 'diagnostics')).toHaveAttribute('data-diagnostic', 'turn-failed', {
      timeout: 45_000,
    });
    await expect(tid(a.page, 'ended-reason')).toHaveAttribute('data-kind', 'failed');
  } finally {
    await closeAll(a, b);
  }
});
