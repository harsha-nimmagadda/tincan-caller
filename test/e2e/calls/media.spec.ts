import { expect, test, type Page } from '@playwright/test';
import type { EngineName } from '../browsers';
import {
  closeAll,
  debugInfo,
  expectConnected,
  expectRemoteVideoPlaying,
  handshake,
  openHarness,
  tid,
  type Party,
} from './helpers';

const engines: EngineName[] = ['chromium', 'firefox', 'webkit'];

async function call(
  a: EngineName,
  b: EngineName,
  baseURL: string | undefined,
  qa: string,
  qb = 'fake=1',
) {
  const pa = await openHarness(a, baseURL ?? '', qa);
  const pb = await openHarness(b, baseURL ?? '', qb);
  await handshake(pa.page, pb.page);
  await expectConnected(pa.page, pb.page);
  return { pa, pb };
}

const facing = (p: Page) => tid(p, 'local-facing');
const withParties = async (parties: Party[], fn: () => Promise<void>) => {
  try {
    await fn();
  } finally {
    await closeAll(...parties);
  }
};

// ---- controls, per engine on the sending side ----
for (const engine of engines) {
  test.describe(`media controls (${engine})`, () => {
    test('cam off really stops the camera track; cam on brings video back', async ({ baseURL }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1');
      await withParties([pa, pb], async () => {
        expect((await debugInfo(pa.page)).videoLive).toBe(true);
        await tid(pa.page, 'btn-cam').click();
        await expect.poll(async () => (await debugInfo(pa.page)).videoLive).toBe(false);
        await expect(tid(pb.page, 'remote-cam-off')).toBeVisible();
        await tid(pa.page, 'btn-cam').click();
        await expect.poll(async () => (await debugInfo(pa.page)).videoLive).toBe(true);
        await expect(tid(pb.page, 'remote-cam-off')).toBeHidden();
        await expectRemoteVideoPlaying(pb.page);
      });
    });

    test('mic mute is reported to the peer and the track stays alive', async ({ baseURL }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1');
      await withParties([pa, pb], async () => {
        await tid(pa.page, 'btn-mic').click();
        await expect(tid(pb.page, 'remote-mic-off')).toBeVisible();
        expect((await debugInfo(pa.page)).liveLocalTracks).toBe(2);
        await tid(pa.page, 'btn-mic').click();
        await expect(tid(pb.page, 'remote-mic-off')).toBeHidden();
      });
    });

    test('flip camera (phone mode): facing changes, the preview un-mirrors, peer keeps getting video', async ({
      baseURL,
    }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1&mobile=1');
      await withParties([pa, pb], async () => {
        await expect(tid(pa.page, 'btn-flip')).toBeVisible();
        await expect(facing(pa.page)).toHaveText('user');
        await expect(tid(pa.page, 'local-mirror')).toHaveText('true');
        await tid(pa.page, 'btn-flip').click();
        await expect(facing(pa.page)).toHaveText('environment');
        await expect(tid(pa.page, 'local-mirror')).toHaveText('false');
        await expectRemoteVideoPlaying(pb.page);
        await tid(pa.page, 'btn-flip').click();
        await expect(facing(pa.page)).toHaveText('user');
        await expectRemoteVideoPlaying(pb.page);
      });
    });

    test('device picker switches the camera mid-call without dropping it', async ({ baseURL }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1');
      await withParties([pa, pb], async () => {
        await tid(pa.page, 'sel-videoinput').selectOption('cam-back');
        await expect(facing(pa.page)).toHaveText('environment');
        await expect(tid(pa.page, 'call-state')).toHaveText('connected');
        await expectRemoteVideoPlaying(pb.page);
        await tid(pa.page, 'sel-audioinput').selectOption({ index: 0 });
        await expect(tid(pa.page, 'call-state')).toHaveText('connected');
      });
    });

    test('unplugging the active camera falls back to the default one', async ({ baseURL }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1');
      await withParties([pa, pb], async () => {
        await tid(pa.page, 'sel-videoinput').selectOption('cam-back');
        await expect(facing(pa.page)).toHaveText('environment');
        await pa.page.evaluate(() =>
          (window as unknown as { __tincan: { unplug(id: string): void } }).__tincan.unplug(
            'cam-back',
          ),
        );
        await expect(facing(pa.page)).toHaveText('user');
        await expect.poll(async () => (await debugInfo(pa.page)).videoLive).toBe(true);
        await expect(tid(pa.page, 'btn-flip')).toBeHidden(); // only one camera left
        await expectRemoteVideoPlaying(pb.page);
      });
    });

    test('capture killed in the background is re-acquired when visible again', async ({
      baseURL,
    }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1');
      await withParties([pa, pb], async () => {
        await pa.page.evaluate(() =>
          (
            window as unknown as { __tincan: { simulateBackgroundKill(): void } }
          ).__tincan.simulateBackgroundKill(),
        );
        await expect.poll(async () => (await debugInfo(pa.page)).liveLocalTracks).toBe(2);
        await expect(tid(pa.page, 'call-state')).toHaveText('connected');
        await expectRemoteVideoPlaying(pb.page);
      });
    });

    test('the quality preset caps the video sender bitrate', async ({ baseURL }) => {
      const { pa, pb } = await call(engine, 'chromium', baseURL, 'fake=1&quality=data-saver');
      await withParties([pa, pb], async () => {
        await expect
          .poll(async () => (await debugInfo(pa.page)).videoMaxBitrate, { timeout: 10_000 })
          .toBe(300_000);
      });
    });
  });
}
