import { afterEach, describe, expect, it } from 'vitest';
import { listenForAnswers, sendAnswer } from '../../src/core/signaling/tab-bridge';

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((s) => s()));
const listen = (accept: (t: string) => Promise<boolean>) => {
  const stop = listenForAnswers(accept);
  stops.push(stop);
  return stop;
};

describe('tab bridge', () => {
  it('a listening caller tab accepts the reply and the sender learns of it', async () => {
    const got: string[] = [];
    listen(async (t) => (got.push(t), true));
    expect(await sendAnswer('TOKEN', 500)).toBe(true);
    expect(got).toEqual(['TOKEN']);
  });

  it('nobody listening → resolves false after the timeout', async () => {
    const t0 = Date.now();
    expect(await sendAnswer('TOKEN', 80)).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });

  it('a listener that rejects the reply (different invite) sends no acknowledgement', async () => {
    listen(async () => false);
    expect(await sendAnswer('TOKEN', 120)).toBe(false);
  });

  it('still acknowledges when it is stopped while processing (the real flow stops it on accept)', async () => {
    let stop: () => void = () => undefined;
    stop = listen(async () => {
      stop(); // accepting moves the call on, which stops the listener before the ack goes out
      return true;
    });
    expect(await sendAnswer('TOKEN', 500)).toBe(true);
  });

  it('a stopped listener ignores later replies', async () => {
    const got: string[] = [];
    const stop = listen(async (t) => (got.push(t), true));
    stop();
    expect(await sendAnswer('LATE', 100)).toBe(false);
    expect(got).toEqual([]);
  });

  it('ignores malformed messages', async () => {
    const got: string[] = [];
    listen(async (t) => (got.push(t), true));
    const ch = new BroadcastChannel('tincan-bridge');
    for (const bad of [
      null,
      'x',
      { t: 'answer' },
      { t: 'answer', token: 5 },
      { t: 'answer', token: 'x'.repeat(2000) },
      { t: 'other' },
    ])
      ch.postMessage(bad);
    await new Promise((r) => setTimeout(r, 60));
    ch.close();
    expect(got).toEqual([]);
  });
});
