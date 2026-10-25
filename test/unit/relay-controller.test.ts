import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayMsg } from '../../src/core/signaling/relay/messages';
import {
  RelayController,
  UNREACHABLE_AFTER_MS,
  type RelayHost,
  type RelayStatus,
  type RelayTransport,
} from '../../src/core/signaling/relay/relay-controller';

const LOW = '1'.repeat(16);
const HIGH = '9'.repeat(16);

/** An in-memory "relay": everything one peer publishes reaches every other peer. */
class Bus {
  peers = new Set<FakeTransport>();
  log: RelayMsg[] = [];
}
class FakeTransport implements RelayTransport {
  connected = 1;
  private msgCbs = new Set<(m: RelayMsg) => void>();
  private statusCbs = new Set<() => void>();
  closed = false;
  constructor(private bus: Bus) {
    bus.peers.add(this);
  }
  async publish(msg: RelayMsg) {
    this.bus.log.push(msg);
    for (const p of this.bus.peers)
      if (p !== this && !p.closed) queueMicrotask(() => p.msgCbs.forEach((cb) => cb(msg)));
  }
  onMessage(cb: (m: RelayMsg) => void) {
    this.msgCbs.add(cb);
    return () => void this.msgCbs.delete(cb);
  }
  status() {
    return { connected: this.connected, total: 4 };
  }
  onStatus(cb: () => void) {
    this.statusCbs.add(cb);
    return () => void this.statusCbs.delete(cb);
  }
  setConnected(n: number) {
    this.connected = n;
    this.statusCbs.forEach((cb) => cb());
  }
  close() {
    this.closed = true;
  }
}

class FakeHost implements RelayHost {
  offers = 0;
  accepted: string[] = [];
  applied: string[] = [];
  disposed = 0;
  notices: string[] = [];
  failApply = false;
  constructor(private name: string) {}
  async createOffer() {
    return `OFFER-${this.name}-${++this.offers}`;
  }
  async acceptOffer(token: string) {
    this.accepted.push(token);
    return `ANSWER-${this.name}(${token})`;
  }
  async applyAnswer(token: string) {
    if (this.failApply) throw new Error('mismatch');
    this.applied.push(token);
  }
  disposeSession() {
    this.disposed++;
  }
  notice(what: 'third-party' | 'peer-left') {
    this.notices.push(what);
  }
}

function peer(id: string, bus: Bus, name: string) {
  const transport = new FakeTransport(bus);
  const host = new FakeHost(name);
  const statuses: RelayStatus[] = [];
  const controller = new RelayController({
    myId: id,
    transport,
    host,
    onStatus: (s) => statuses.push(s),
  });
  return { transport, host, statuses, controller, last: () => statuses.at(-1) };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RelayController: two peers meet through the relays', () => {
  it('pair, exchange offer/answer, and report connected', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(caller.host.offers).toBe(1);
    expect(callee.host.accepted).toEqual(['OFFER-A-1']);
    expect(caller.host.applied).toEqual(['ANSWER-B(OFFER-A-1)']);
    expect(caller.last()?.phase).toBe('peer-found');

    caller.controller.sessionConnected();
    callee.controller.sessionConnected();
    expect(caller.last()?.phase).toBe('connected');
    expect(callee.last()?.phase).toBe('connected');
  });

  it('keeps re-sending the offer every 4 s until answered (the callee joins late)', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    caller.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    const callee = peer(HIGH, bus, 'B');
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100); // the late joiner's hello reaches the caller
    await vi.advanceTimersByTimeAsync(4100);
    expect(caller.host.applied.length).toBe(1);
    expect(bus.log.filter((m) => m.t === 'offer').length).toBeGreaterThanOrEqual(1);
  });

  it('a duplicate offer gets the same answer without a new session', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    const answersBefore = bus.log.filter((m) => m.t === 'answer').length;
    const offer = bus.log.find((m) => m.t === 'offer');
    if (offer) await caller.transport.publish(offer); // the relay delivers it a second time
    await vi.advanceTimersByTimeAsync(100);
    expect(callee.host.accepted).toHaveLength(1);
    expect(bus.log.filter((m) => m.t === 'answer').length).toBe(answersBefore + 1);
  });

  it('auto-reconnect: when the session fails both sides go back to waiting and meet again', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    caller.controller.sessionConnected();
    callee.controller.sessionConnected();

    caller.controller.sessionFailed();
    callee.controller.sessionFailed();
    expect(caller.last()?.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(100);
    expect(caller.host.offers).toBe(2); // a fresh session, not the old one
    expect(callee.host.accepted).toEqual(['OFFER-A-1', 'OFFER-A-2']);
    expect(caller.host.disposed).toBeGreaterThan(0);
  });

  it('a refreshed peer (new id) is accepted after the old session failed', async () => {
    const bus = new Bus();
    const callee = peer(HIGH, bus, 'B');
    const first = peer(LOW, bus, 'A1');
    callee.controller.start();
    first.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    callee.controller.sessionConnected();
    // The first tab disappears (reload): its transport is gone, the callee's session fails.
    first.controller.leave();
    callee.controller.sessionFailed();
    const reborn = peer('2'.repeat(16), bus, 'A2');
    reborn.controller.start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(callee.host.accepted.at(-1)).toBe('OFFER-A2-1');
  });

  it('applying an answer that is rejected restarts the search instead of hanging', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    caller.host.failApply = true;
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(caller.last()?.phase).toBe('waiting');
  });

  it('a third person is reported to the host once and the pair is unaffected', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    const third = peer('5'.repeat(16), bus, 'C');
    third.controller.start();
    await vi.advanceTimersByTimeAsync(7000);
    expect(caller.host.notices.filter((n) => n === 'third-party')).toHaveLength(1);
    expect(callee.host.notices.filter((n) => n === 'third-party')).toHaveLength(1);
    expect(caller.host.accepted).toEqual([]);
  });

  it('bye from the peer reaches the host as peer-left', async () => {
    const bus = new Bus();
    const caller = peer(LOW, bus, 'A');
    const callee = peer(HIGH, bus, 'B');
    caller.controller.start();
    callee.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    caller.controller.leave();
    await vi.advanceTimersByTimeAsync(100);
    expect(callee.host.notices).toContain('peer-left');
    expect(callee.last()?.phase).toBe('left');
  });
});

describe('RelayController: connectivity and cleanup', () => {
  it('reports connecting → waiting as relays come up', async () => {
    const bus = new Bus();
    const p = peer(LOW, bus, 'A');
    p.transport.connected = 0;
    p.controller.start();
    expect(p.last()).toMatchObject({
      phase: 'connecting',
      relaysConnected: 0,
      relaysTotal: 4,
      unreachable: false,
    });
    p.transport.setConnected(2);
    expect(p.last()).toMatchObject({ phase: 'waiting', relaysConnected: 2 });
  });

  it('no relay within 8 s → unreachable; one connecting later clears it', async () => {
    const bus = new Bus();
    const p = peer(LOW, bus, 'A');
    p.transport.connected = 0;
    p.controller.start();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_AFTER_MS - 1);
    expect(p.last()?.unreachable).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(p.last()?.unreachable).toBe(true);
    p.transport.setConnected(1);
    expect(p.last()?.unreachable).toBe(false);
  });

  it('a reachable relay never triggers "unreachable"', async () => {
    const p = peer(LOW, new Bus(), 'A');
    p.controller.start();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_AFTER_MS + 100);
    expect(p.last()?.unreachable).toBe(false);
  });

  it('leave() closes the transport, stops every timer and is idempotent', async () => {
    const bus = new Bus();
    const p = peer(LOW, bus, 'A');
    p.controller.start();
    await settle();
    expect(p.controller.activeTimers).toBeGreaterThan(0);
    p.controller.leave();
    p.controller.leave();
    expect(p.transport.closed).toBe(true);
    expect(p.controller.activeTimers).toBe(0);
    expect(p.last()?.phase).toBe('left');
    expect(bus.log.filter((m) => m.t === 'bye').length).toBe(1);
  });

  it('a failing publish (dead relay) does not break the controller', async () => {
    const bus = new Bus();
    const p = peer(LOW, bus, 'A');
    p.transport.publish = async () => {
      throw new Error('socket closed');
    };
    p.controller.start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(p.controller.phase).toBe('waiting');
  });

  it('ignores messages after leaving', async () => {
    const bus = new Bus();
    const a = peer(LOW, bus, 'A');
    const b = peer(HIGH, bus, 'B');
    a.controller.start();
    a.controller.leave();
    b.controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.host.offers).toBe(0);
  });
});
