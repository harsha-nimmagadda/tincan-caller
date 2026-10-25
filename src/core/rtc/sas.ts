import { decodeBase64Url, encodeBase64Url } from '../encoding/base64url';
import { bytesEqual, concatBytes, randomBytes, sha256, u32be, utf8 } from '../encoding/bytes';
import type { Ctl } from './control';

const SAS_LABEL = utf8('tincan-sas-v1');
export const NONCE_BYTES = 16;

/** commit = SHA-256(nonce)[0..16] */
export async function computeCommit(nonce: Uint8Array): Promise<Uint8Array> {
  return (await sha256(nonce)).slice(0, 16);
}

/** 6-digit safety code, shown as "123 456" (§6.7 step 5). */
export async function computeSas(
  fpCaller: Uint8Array,
  fpCallee: Uint8Array,
  nA: Uint8Array,
  nB: Uint8Array,
): Promise<string> {
  const h = await sha256(concatBytes(SAS_LABEL, fpCaller, fpCallee, nA, nB));
  const digits = String(u32be(h) % 1_000_000).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export type SasOutcome = { send?: Ctl; code?: string; error?: 'sas-commit-mismatch' } | null;

interface Params {
  role: 'caller' | 'callee';
  localFingerprint: Uint8Array;
  remoteFingerprint: Uint8Array;
  /** Callee: the nonce whose commit went into the answer token. Caller: omit. */
  nonce?: Uint8Array;
  /** Caller: the commit from the answer token. */
  commit?: Uint8Array;
}

/** Commit–reveal message handling. Out-of-order or repeated messages are ignored (return null). */
export class SasExchange {
  private done = false;
  private sentSas1 = false;
  private readonly nonce: Uint8Array;

  constructor(private readonly p: Params) {
    this.nonce = p.nonce ?? randomBytes(NONCE_BYTES);
  }

  /** Caller only: the first message, to send when `ctl` opens. */
  begin(): Ctl | null {
    if (this.p.role !== 'caller' || this.sentSas1) return null;
    this.sentSas1 = true;
    return { t: 'sas1', n: encodeBase64Url(this.nonce) };
  }

  async handle(msg: Ctl): Promise<SasOutcome> {
    if (this.done) return null;
    if (msg.t === 'sas1' && this.p.role === 'callee') return this.onSas1(msg.n);
    if (msg.t === 'sas2' && this.p.role === 'caller' && this.sentSas1) return this.onSas2(msg.n);
    return null;
  }

  private async onSas1(n: string): Promise<SasOutcome> {
    const nA = decodeNonce(n);
    if (!nA) return null;
    this.done = true;
    const code = await computeSas(
      this.p.remoteFingerprint,
      this.p.localFingerprint,
      nA,
      this.nonce,
    );
    return { send: { t: 'sas2', n: encodeBase64Url(this.nonce) }, code };
  }

  private async onSas2(n: string): Promise<SasOutcome> {
    const nB = decodeNonce(n);
    if (!nB || !this.p.commit) return null;
    this.done = true;
    if (!bytesEqual(await computeCommit(nB), this.p.commit)) {
      return { error: 'sas-commit-mismatch' };
    }
    return {
      code: await computeSas(this.p.localFingerprint, this.p.remoteFingerprint, this.nonce, nB),
    };
  }
}

function decodeNonce(n: string): Uint8Array | null {
  const b = decodeBase64Url(n);
  return b && b.length === NONCE_BYTES ? b : null;
}
