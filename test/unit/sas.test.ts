import { describe, expect, it } from 'vitest';
import { encodeBase64Url } from '../../src/core/encoding/base64url';
import { computeCommit, computeSas, SasExchange } from '../../src/core/rtc/sas';

const fpA = new Uint8Array(32).fill(0xaa);
const fpB = new Uint8Array(32).fill(0xbb);
const nA = Uint8Array.from({ length: 16 }, (_, i) => i);
const nB = Uint8Array.from({ length: 16 }, (_, i) => 0x80 + i);

async function pair(commitOverride?: Uint8Array) {
  const callee = new SasExchange({
    role: 'callee',
    localFingerprint: fpB,
    remoteFingerprint: fpA,
    nonce: nB,
  });
  const caller = new SasExchange({
    role: 'caller',
    localFingerprint: fpA,
    remoteFingerprint: fpB,
    nonce: nA,
    commit: commitOverride ?? (await computeCommit(nB)),
  });
  return { caller, callee };
}

describe('SAS', () => {
  it('fixed vector: code is 6 digits "123 456" style and deterministic', async () => {
    const code = await computeSas(fpA, fpB, nA, nB);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await computeSas(fpA, fpB, nA, nB)).toBe(code);
    expect(code).toBe('864 825'); // cross-checked with Python hashlib
  });
  it('role order matters and every input changes the code', async () => {
    const base = await computeSas(fpA, fpB, nA, nB);
    expect(await computeSas(fpB, fpA, nA, nB)).not.toBe(base);
    expect(await computeSas(fpA, fpB, nB, nA)).not.toBe(base);
    expect(await computeSas(fpA, new Uint8Array(32), nA, nB)).not.toBe(base);
  });
  it('commit is the first 16 bytes of SHA-256(nonce)', async () => {
    expect(await computeCommit(nB)).toHaveLength(16);
  });

  it('full exchange: both sides compute the same code', async () => {
    const { caller, callee } = await pair();
    const sas1 = caller.begin();
    expect(sas1?.t).toBe('sas1');
    const r2 = await callee.handle(sas1!);
    expect(r2?.send?.t).toBe('sas2');
    const r3 = await caller.handle(r2!.send!);
    expect(r3?.code).toBeDefined();
    expect(r3?.code).toBe(r2?.code);
    expect(r3?.code).toBe(await computeSas(fpA, fpB, nA, nB));
  });
  it('commit mismatch is detected', async () => {
    const { caller, callee } = await pair(new Uint8Array(16));
    const r2 = await callee.handle(caller.begin()!);
    expect(await caller.handle(r2!.send!)).toEqual({ error: 'sas-commit-mismatch' });
  });
  it('sas2 without a prior sas1 is ignored', async () => {
    const { caller } = await pair();
    expect(await caller.handle({ t: 'sas2', n: encodeBase64Url(nB) })).toBeNull();
  });
  it('callee ignores sas2, caller ignores sas1, repeats are ignored', async () => {
    const { caller, callee } = await pair();
    expect(await callee.handle({ t: 'sas2', n: encodeBase64Url(nB) })).toBeNull();
    const sas1 = caller.begin()!;
    expect(caller.begin()).toBeNull();
    expect(await caller.handle(sas1)).toBeNull();
    expect(await callee.handle(sas1)).not.toBeNull();
    expect(await callee.handle(sas1)).toBeNull();
    expect(await callee.handle({ t: 'bye' })).toBeNull();
  });
  it('callee cannot begin; bad nonces are ignored', async () => {
    const { caller, callee } = await pair();
    expect(callee.begin()).toBeNull();
    expect(await callee.handle({ t: 'sas1', n: 'short' })).toBeNull();
    caller.begin();
    expect(await caller.handle({ t: 'sas2', n: 'short' })).toBeNull();
  });
  it('caller without a commit never accepts', async () => {
    const c = new SasExchange({ role: 'caller', localFingerprint: fpA, remoteFingerprint: fpB });
    c.begin();
    expect(await c.handle({ t: 'sas2', n: encodeBase64Url(nB) })).toBeNull();
  });
  it('generates a random nonce when none is given', () => {
    const c = new SasExchange({ role: 'caller', localFingerprint: fpA, remoteFingerprint: fpB });
    expect(c.begin()).not.toEqual(
      new SasExchange({ role: 'caller', localFingerprint: fpA, remoteFingerprint: fpB }).begin(),
    );
  });
});
