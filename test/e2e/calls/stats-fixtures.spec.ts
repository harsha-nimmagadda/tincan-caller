import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { EngineName } from '../browsers';
import { sanitizeAddresses } from './sanitize';
import {
  closeAll,
  expectConnected,
  expectRemoteVideoPlaying,
  handshake,
  openHarness,
} from './helpers';

// Opt-in: CAPTURE_STATS=1 pnpm e2e --project=calls stats-fixtures  → test/fixtures/stats/<engine>.json
// Each file holds two getStats() samples ~1.5 s apart (for delta-based bitrate/loss) from the caller.
test.skip(!process.env['CAPTURE_STATS'], 'set CAPTURE_STATS=1 to regenerate the stats fixtures');

for (const engine of ['chromium', 'firefox', 'webkit'] as EngineName[]) {
  test(`capture getStats() from ${engine}`, async ({ baseURL }) => {
    const a = await openHarness(engine, baseURL ?? '');
    const b = await openHarness('chromium', baseURL ?? '');
    try {
      await handshake(a.page, b.page);
      await expectConnected(a.page, b.page);
      await expectRemoteVideoPlaying(a.page);
      const sample = () =>
        a.page.evaluate(async () => ({
          t: Date.now(),
          entries: await (
            window as unknown as { __tincan: { stats(): Promise<unknown[]> } }
          ).__tincan.stats(),
        }));
      const first = await sample();
      await a.page.waitForTimeout(1500);
      const second = await sample();
      writeFileSync(
        new URL(`../../fixtures/stats/${engine}.json`, import.meta.url),
        JSON.stringify(sanitizeAddresses({ engine, samples: [first, second] }), null, 1),
      );
    } finally {
      await closeAll(a, b);
    }
  });
}
