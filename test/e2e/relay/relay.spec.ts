import { expect, test } from '@playwright/test';
import { startMockRelay, type MockRelay } from '../../../scripts/mock-nostr-relay';
import type { EngineName } from '../browsers';
import { closeAll, expectRemoteVideoPlaying, expectSameSafetyCode, tid } from '../ui/helpers';
import { expectConnectedBoth, joinRelayLink, openRelayApp, startRelayCall } from './helpers';

let relay: MockRelay;
test.beforeAll(async () => void (relay = await startMockRelay()));
test.afterAll(async () => relay.close());

const pairs: [EngineName, EngineName][] = [
  ['chromium', 'chromium'],
  ['chromium', 'firefox'],
  ['firefox', 'chromium'],
  ['chromium', 'webkit'],
  ['webkit', 'chromium'],
];

for (const [ea, eb] of pairs) {
  test(`7. relay call ${ea} → ${eb}: one shared link, no codes, connects and flows`, async ({
    baseURL,
  }) => {
    const a = await openRelayApp(ea, baseURL ?? '', relay.url);
    const b = await openRelayApp(eb, baseURL ?? '', relay.url);
    try {
      const link = await startRelayCall(a.page);
      expect(link).toContain('#r=');
      await expect(tid(a.page, 'relay-relays')).toContainText('1 of 1', { timeout: 10_000 });
      await joinRelayLink(b.page, link);
      await expectConnectedBoth(a.page, b.page);
      await expectRemoteVideoPlaying(a.page);
      await expectRemoteVideoPlaying(b.page);
      await expectSameSafetyCode(a.page, b.page);
      expect(new URL(b.page.url()).hash).toBe(''); // the secret link is stripped from the address bar
    } finally {
      await closeAll(a, b);
    }
  });
}

test('7b. auto-reconnect: A reloads its page and the call comes back by itself', async ({
  baseURL,
}) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url);
  try {
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
    expect(await a.page.evaluate(() => sessionStorage.getItem('tincan.relay.v1'))).not.toBeNull(); // this tab's room

    await a.page.reload(); // a new page, a new instance id — and no #r= in the address bar
    await expect(tid(b.page, 'reconnecting')).toBeVisible({ timeout: 20_000 }); // B notices and searches again
    await expectConnectedBoth(a.page, b.page, 60_000);
    await expectRemoteVideoPlaying(a.page);
    await expectRemoteVideoPlaying(b.page);
    await expect(tid(b.page, 'reconnecting')).toHaveCount(0);
  } finally {
    await closeAll(a, b);
  }
});

test('7c. reloading the OTHER side works too, and a second reload still recovers', async ({
  baseURL,
}) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('firefox', baseURL ?? '', relay.url);
  try {
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
    await b.page.reload();
    await expectConnectedBoth(a.page, b.page, 60_000);
    await a.page.reload();
    await expectConnectedBoth(a.page, b.page, 60_000);
  } finally {
    await closeAll(a, b);
  }
});

test('hangup ends the call for both; the other side can choose to wait for a rejoin; the tab forgets the room', async ({
  baseURL,
}) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url);
  try {
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);

    await tid(a.page, 'btn-hangup').click();
    await expect(tid(a.page, 'ended-reason')).toHaveAttribute('data-reason', 'local-hangup');
    await expect(tid(b.page, 'ended-reason')).toHaveAttribute('data-reason', 'remote-hangup', {
      timeout: 5000,
    });
    expect(await a.page.evaluate(() => sessionStorage.getItem('tincan.relay.v1'))).toBeNull();
    expect(await b.page.evaluate(() => sessionStorage.getItem('tincan.relay.v1'))).toBeNull();
    await expect(tid(a.page, 'relay-rejoin')).toHaveCount(0); // the one who hung up has nothing to wait for

    await tid(b.page, 'relay-rejoin').click();
    await expect(tid(b.page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
    await tid(b.page, 'lobby-continue').click();
    await expect(tid(b.page, 'relay-status')).toHaveAttribute('data-phase', 'waiting', {
      timeout: 15_000,
    });
  } finally {
    await closeAll(a, b);
  }
});

test('a third person with the link is told nothing works for them; the call is unaffected', async ({
  baseURL,
}) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const c = await openRelayApp('chromium', baseURL ?? '', relay.url);
  try {
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
    await joinRelayLink(c.page, link);
    // Either member of the pair tells its user (a toast), once.
    const toastCount = async () =>
      (await a.page.getByText('Someone else opened this link').count()) +
      (await b.page.getByText('Someone else opened this link').count());
    await expect.poll(toastCount, { timeout: 15_000, intervals: [100] }).toBeGreaterThan(0);
    await expect(tid(a.page, 'call-state')).toHaveAttribute('data-state', 'connected');
    await expect(tid(b.page, 'call-state')).toHaveAttribute('data-state', 'connected');
    await expect(tid(c.page, 'call-state')).not.toHaveAttribute('data-state', 'connected');
    await expect(tid(c.page, 'relay-status')).toHaveAttribute('data-phase', 'waiting'); // the room is locked to the first pair
  } finally {
    await closeAll(a, b, c);
  }
});

test.describe('consent', () => {
  test('opening a relay link without relays enabled asks first; Cancel goes home and connects to nothing', async ({
    baseURL,
  }) => {
    const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
    const b = await openRelayApp('chromium', baseURL ?? '', relay.url, { relayEnabled: false });
    try {
      const link = await startRelayCall(a.page);
      const clientsBefore = relay.clients();
      await b.page.goto(link.replace('#', '?fake=1#'));
      await expect(tid(b.page, 'relay-consent')).toBeVisible();
      await expect(tid(b.page, 'relay-consent')).toContainText('IP address');
      await tid(b.page, 'relay-consent-cancel').click();
      await expect(tid(b.page, 'start-call')).toBeVisible();
      await b.page.waitForTimeout(800);
      expect(relay.clients()).toBe(clientsBefore); // it never talked to a relay
    } finally {
      await closeAll(a, b);
    }
  });

  test('Allow for this call proceeds and connects, but is NOT remembered', async ({ baseURL }) => {
    const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
    const b = await openRelayApp('chromium', baseURL ?? '', relay.url, { relayEnabled: false });
    try {
      const link = await startRelayCall(a.page);
      await b.page.goto(link.replace('#', '?fake=1#'));
      await tid(b.page, 'relay-consent-allow').click();
      await expect(tid(b.page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
      await tid(b.page, 'lobby-continue').click();
      await expectConnectedBoth(a.page, b.page);
      expect(
        await b.page.evaluate(
          () => JSON.parse(localStorage.getItem('tincan.settings.v1') ?? '{}').relayEnabled,
        ),
      ).toBe(false);
      await tid(b.page, 'btn-hangup').click();
      await tid(b.page, 'go-home').click();
      await tid(b.page, 'start-call').click();
      await expect(tid(b.page, 'mode-relay')).not.toBeChecked(); // still default manual: nothing was stored
    } finally {
      await closeAll(a, b);
    }
  });

  test('choosing Automatic in the lobby asks first; Cancel keeps manual mode', async ({
    baseURL,
  }) => {
    const a = await openRelayApp('chromium', baseURL ?? '', relay.url, { relayEnabled: false });
    try {
      await tid(a.page, 'start-call').click();
      await expect(tid(a.page, 'mode-manual')).toBeChecked();
      await tid(a.page, 'mode-relay').click();
      await expect(tid(a.page, 'relay-consent')).toBeVisible();
      await tid(a.page, 'relay-consent-cancel').click();
      await expect(tid(a.page, 'mode-manual')).toBeChecked();
      await tid(a.page, 'mode-relay').click();
      await tid(a.page, 'relay-consent-allow').click();
      await expect(tid(a.page, 'mode-relay')).toBeChecked();
      await expect(tid(a.page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
      await tid(a.page, 'lobby-continue').click();
      await expect(tid(a.page, 'relay-qr')).toBeVisible({ timeout: 15_000 });
    } finally {
      await closeAll(a);
    }
  });
});

test('unreachable relays: after 8 s the creator is told and can switch to a manual invite', async ({
  baseURL,
}) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url, {
    relays: ['ws://localhost:9', 'ws://localhost:19'],
  });
  try {
    await startRelayCall(a.page);
    await expect(tid(a.page, 'relay-relays')).toContainText('0 of 2');
    await expect(tid(a.page, 'relay-unreachable')).toBeHidden(); // not yet
    await expect(tid(a.page, 'relay-unreachable')).toBeVisible({ timeout: 15_000 });
    await tid(a.page, 'relay-switch-manual').click();
    await expect(tid(a.page, 'invite-qr')).toBeVisible({ timeout: 15_000 }); // a normal manual invite
    expect(await a.page.evaluate(() => sessionStorage.getItem('tincan.relay.v1'))).toBeNull();
  } finally {
    await closeAll(a);
  }
});

test('one dead relay among live ones does not stop a call', async ({ baseURL }) => {
  const relays = ['ws://localhost:9', relay.url];
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url, { relays });
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url, { relays });
  try {
    const link = await startRelayCall(a.page);
    await expect(tid(a.page, 'relay-relays')).toContainText('1 of 2', { timeout: 10_000 });
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
  } finally {
    await closeAll(a, b);
  }
});

test('relays only ever see ciphertext: no secret, no SDP, no addresses', async ({ baseURL }) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url);
  try {
    const start = relay.events.length;
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
    const secret = new URL(link).hash.slice(3);
    const seen = relay.events.slice(start);
    expect(seen.length).toBeGreaterThan(3); // hellos, offer, answer...
    const wire = JSON.stringify(seen);
    for (const forbidden of [
      secret,
      'candidate',
      'fingerprint',
      'ice-ufrag',
      '192.168',
      '127.0.0.1',
      'offer',
      'answer',
    ]) {
      expect(wire, forbidden).not.toContain(forbidden);
    }
    for (const e of seen) {
      expect(e.kind).toBe(25050);
      expect(e['content']).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(e.tags).toEqual([['x', expect.stringMatching(/^[0-9a-f]{32}$/)]]);
    }
  } finally {
    await closeAll(a, b);
  }
});

test('Settings: Test reports which relays answer', async ({ baseURL }) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  try {
    await tid(a.page, 'open-settings').click();
    await expect(tid(a.page, 'relay-list')).toHaveValue(relay.url);
    await tid(a.page, 'relay-list').fill(`${relay.url}\nws://localhost:9\nhttp://not-a-relay`);
    await expect(a.page.getByRole('alert').filter({ hasText: '1' }).first()).toBeVisible(); // the invalid line is called out
    await tid(a.page, 'relay-test').click();
    const results = tid(a.page, 'relay-test-results');
    await expect(results.locator(`[data-url="${relay.url}"]`)).toHaveAttribute('data-state', 'ok', {
      timeout: 15_000,
    });
    await expect(results.locator('[data-url="ws://localhost:9"]')).toHaveAttribute(
      'data-state',
      'fail',
      { timeout: 15_000 },
    );
    await expect(results.locator('li')).toHaveCount(2);
  } finally {
    await closeAll(a);
  }
});

test('the relay secret never goes to a server, a Referer or localStorage', async ({ baseURL }) => {
  const a = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const b = await openRelayApp('chromium', baseURL ?? '', relay.url);
  const requests: { url: string; referer: string | undefined }[] = [];
  for (const app of [a, b])
    app.page.on('request', (r) => requests.push({ url: r.url(), referer: r.headers()['referer'] }));
  try {
    const link = await startRelayCall(a.page);
    await joinRelayLink(b.page, link);
    await expectConnectedBoth(a.page, b.page);
    const secret = new URL(link).hash.slice(3);
    expect(requests.some((r) => r.url.includes(secret))).toBe(false);
    expect(requests.filter((r) => r.referer)).toEqual([]);
    for (const p of [a.page, b.page]) {
      expect(await p.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(secret);
      expect(await p.evaluate(() => Object.keys(localStorage))).toEqual(['tincan.settings.v1']);
    }
  } finally {
    await closeAll(a, b);
  }
});
