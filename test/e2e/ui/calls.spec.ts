import { expect, test } from '@playwright/test';
import type { EngineName } from '../browsers';
import {
  closeAll,
  connect,
  expectRemoteVideoPlaying,
  expectSameSafetyCode,
  openApp,
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
  test(`1/2. real UI call ${ea} → ${eb}: link handshake, video flows, safety codes match`, async ({
    baseURL,
  }) => {
    const a = await openApp(ea, baseURL ?? '');
    const b = await openApp(eb, baseURL ?? '');
    try {
      await connect(a.page, b.page);
      await expectRemoteVideoPlaying(a.page);
      await expectRemoteVideoPlaying(b.page);
      await expectSameSafetyCode(a.page, b.page);
    } finally {
      await closeAll(a, b);
    }
  });
}

test('4. media state: camera and microphone switches reach the other side', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('firefox', baseURL ?? '');
  try {
    await connect(a.page, b.page);
    await expect(tid(b.page, 'remote-cam-off')).toHaveCount(0);
    await tid(a.page, 'btn-cam').click();
    await expect(tid(b.page, 'remote-cam-off')).toBeVisible();
    await tid(a.page, 'btn-mic').click();
    await expect(tid(b.page, 'remote-mic-off')).toBeVisible();
    await tid(a.page, 'btn-mic').click();
    await expect(tid(b.page, 'remote-mic-off')).toHaveCount(0);
    await tid(a.page, 'btn-cam').click();
    await expect(tid(b.page, 'remote-cam-off')).toHaveCount(0);
    await expectRemoteVideoPlaying(b.page);
  } finally {
    await closeAll(a, b);
  }
});

test('5. hangup: the peer sees remote-hangup within 2 s and nothing leaks', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    await connect(a.page, b.page);
    await tid(a.page, 'btn-hangup').click();
    await expect(tid(b.page, 'ended-reason')).toHaveAttribute('data-reason', 'remote-hangup', {
      timeout: 2000,
    });
    await expect(tid(a.page, 'ended-reason')).toHaveAttribute('data-reason', 'local-hangup');
    for (const p of [a.page, b.page]) {
      await expect
        .poll(
          () =>
            p.evaluate(() =>
              (window as unknown as { __tincan: { debug(): unknown } }).__tincan.debug(),
            ),
          { timeout: 3000 },
        )
        .toMatchObject({ connectionState: 'closed', activeTimers: 0, activeListeners: 0 });
      // The camera and microphone are released as well.
      expect(
        await p.evaluate(
          () =>
            (
              window as unknown as {
                __tincan: { store: { getState(): { local: { stream: unknown } } } };
              }
            ).__tincan.store.getState().local.stream,
        ),
      ).toBeNull();
    }
  } finally {
    await closeAll(a, b);
  }
});

for (const [ea, eb] of [
  ['chromium', 'firefox'],
  ['firefox', 'chromium'],
  ['webkit', 'chromium'],
] as [EngineName, EngineName][]) {
  test(`6. audio-only ${ea} → normal ${eb}; turning the camera on mid-call delivers video`, async ({
    baseURL,
  }) => {
    const a = await openApp(ea, baseURL ?? '');
    const b = await openApp(eb, baseURL ?? '');
    try {
      await connect(a.page, b.page, { audioOnlyA: true });
      await expect(tid(b.page, 'remote-cam-off')).toBeVisible();
      await expectRemoteVideoPlaying(a.page); // the audio-only side still receives B's video
      await tid(a.page, 'btn-cam').click();
      await expect(tid(b.page, 'remote-cam-off')).toHaveCount(0);
      await expectRemoteVideoPlaying(b.page);
    } finally {
      await closeAll(a, b);
    }
  });
}

test('6b. "start with camera off" in settings begins calls audio-only', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '', { settings: { startCamOn: false } });
  const b = await openApp('chromium', baseURL ?? '');
  try {
    await connect(a.page, b.page);
    await expect(tid(b.page, 'remote-cam-off')).toBeVisible();
  } finally {
    await closeAll(a, b);
  }
});
