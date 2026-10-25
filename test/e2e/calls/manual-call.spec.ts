import { expect, test } from '@playwright/test';
import type { EngineName } from '../browsers';
import {
  closeAll,
  debugInfo,
  expectConnected,
  expectRemoteVideoPlaying,
  expectSameSas,
  handshake,
  openHarness,
  tid,
} from './helpers';

const pairs: [EngineName, EngineName][] = [
  ['chromium', 'chromium'],
  ['chromium', 'firefox'],
  ['firefox', 'chromium'],
  ['firefox', 'firefox'],
  ['chromium', 'webkit'],
  ['webkit', 'chromium'],
];

for (const [ea, eb] of pairs) {
  test(`1/2. manual call ${ea} → ${eb}: connects, video flows, safety codes match`, async ({
    baseURL,
  }) => {
    const a = await openHarness(ea, baseURL ?? '');
    const b = await openHarness(eb, baseURL ?? '');
    try {
      await handshake(a.page, b.page);
      await expectConnected(a.page, b.page);
      await expectRemoteVideoPlaying(a.page);
      await expectRemoteVideoPlaying(b.page);
      await expectSameSas(a.page, b.page);
    } finally {
      await closeAll(a, b);
    }
  });
}

test('4. media state: cam off and mic off reach the other side', async ({ baseURL }) => {
  const a = await openHarness('chromium', baseURL ?? '');
  const b = await openHarness('firefox', baseURL ?? '');
  try {
    await handshake(a.page, b.page);
    await expectConnected(a.page, b.page);
    await expect(tid(b.page, 'remote-cam-off')).toBeHidden();
    await tid(a.page, 'btn-cam').click();
    await expect(tid(b.page, 'remote-cam-off')).toBeVisible();
    await tid(a.page, 'btn-mic').click();
    await expect(tid(b.page, 'remote-mic-off')).toBeVisible();
    await tid(a.page, 'btn-mic').click();
    await expect(tid(b.page, 'remote-mic-off')).toBeHidden();
    await tid(a.page, 'btn-cam').click(); // camera back on, mid-call
    await expect(tid(b.page, 'remote-cam-off')).toBeHidden();
    await expectRemoteVideoPlaying(b.page);
  } finally {
    await closeAll(a, b);
  }
});

test('5. hangup: peer sees remote-hangup within 2 s and nothing leaks', async ({ baseURL }) => {
  const a = await openHarness('chromium', baseURL ?? '');
  const b = await openHarness('chromium', baseURL ?? '');
  try {
    await handshake(a.page, b.page);
    await expectConnected(a.page, b.page);
    await tid(a.page, 'btn-hangup').click();
    await expect(tid(b.page, 'ended-reason')).toHaveText('remote-hangup', { timeout: 2000 });
    await expect(tid(a.page, 'ended-reason')).toHaveText('local-hangup');
    for (const p of [a.page, b.page]) {
      await expect
        .poll(() => debugInfo(p), { timeout: 3000 })
        .toMatchObject({
          connectionState: 'closed',
          activeTimers: 0,
          activeListeners: 0,
          liveLocalTracks: 0,
        });
    }
  } finally {
    await closeAll(a, b);
  }
});
