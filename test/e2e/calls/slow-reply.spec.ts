import { expect, test } from '@playwright/test';
import type { EngineName } from '../browsers';
import { closeAll, expectConnected, expectRemoteVideoPlaying, openHarness, tid } from './helpers';

// Manual mode: the caller may take a long time to paste the reply. The callee's half-open ICE
// state must not go stale meanwhile (see CallSession.keepWarm). Without keepWarm, a Firefox
// callee failed for any delay over ~30 s; 45 s here is comfortably past that.
const DELAY_MS = 45_000;
const pairs: [EngineName, EngineName][] = [
  ['chromium', 'chromium'],
  ['chromium', 'firefox'],
  ['firefox', 'chromium'],
  ['firefox', 'firefox'],
  ['chromium', 'webkit'],
  ['webkit', 'firefox'],
];

for (const [ea, eb] of pairs) {
  test(`slow reply (45 s) ${ea} → ${eb} still connects`, async ({ baseURL }) => {
    test.setTimeout(150_000);
    const a = await openHarness(ea, baseURL ?? '');
    const b = await openHarness(eb, baseURL ?? '');
    try {
      await tid(a.page, 'start-call').click();
      await expect(tid(a.page, 'invite-code')).not.toHaveValue('', { timeout: 15_000 });
      await tid(b.page, 'offer-input').fill(await tid(a.page, 'invite-code').inputValue());
      await tid(b.page, 'join-submit').click();
      await expect(tid(b.page, 'reply-code')).not.toHaveValue('', { timeout: 15_000 });
      await a.page.waitForTimeout(DELAY_MS);
      await expect(tid(b.page, 'call-state')).toHaveText('awaiting-connection'); // not failed
      await tid(a.page, 'reply-input').fill(await tid(b.page, 'reply-code').inputValue());
      await tid(a.page, 'reply-submit').click();
      await expectConnected(a.page, b.page);
      await expectRemoteVideoPlaying(b.page);
    } finally {
      await closeAll(a, b);
    }
  });
}

// KNOWN LIMITATION: a Firefox caller with a WebKit callee stalls (in `connecting`) when the reply
// takes more than ~35 s. A quick reply works. Tracked here so a fix is noticed.
test.fixme('slow reply (45 s) firefox → webkit', () => undefined);
