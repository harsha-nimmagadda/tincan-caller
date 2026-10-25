import type { Ctl } from './control';

export interface NegotiationDeps {
  pc: RTCPeerConnection;
  /** Caller is impolite, callee is polite. */
  polite: boolean;
  send(msg: Ctl): void;
  /** Runs after a remote offer is applied and before our answer is created. */
  beforeAnswer?(): Promise<void>;
  /** Runs whenever a negotiation round finishes with the connection back in `stable`. */
  onSettled?(): void;
}

/** MDN "perfect negotiation" over the `ctl` channel. */
export class Negotiation {
  private makingOffer = false;
  private ignoreOffer = false;

  constructor(private readonly d: NegotiationDeps) {}

  /** Wire to `pc.onnegotiationneeded`. */
  async onNegotiationNeeded(): Promise<void> {
    const { pc } = this.d;
    try {
      this.makingOffer = true;
      await pc.setLocalDescription();
      const desc = pc.localDescription;
      if (desc && (desc.type === 'offer' || desc.type === 'answer')) {
        this.d.send({ t: 'sdp', type: desc.type, sdp: desc.sdp });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  async handle(msg: Extract<Ctl, { t: 'sdp' } | { t: 'ice' }>): Promise<void> {
    const { pc } = this.d;
    if (msg.t === 'ice') {
      if (!msg.c) return; // end-of-candidates marker
      try {
        await pc.addIceCandidate(msg.c);
      } catch (e) {
        if (!this.ignoreOffer) throw e;
      }
      return;
    }

    const collision = msg.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
    this.ignoreOffer = !this.d.polite && collision;
    if (this.ignoreOffer) return;

    await pc.setRemoteDescription({ type: msg.type, sdp: msg.sdp });
    if (msg.type === 'offer') {
      await this.d.beforeAnswer?.();
      await pc.setLocalDescription();
      const desc = pc.localDescription;
      if (desc?.type === 'answer') this.d.send({ t: 'sdp', type: 'answer', sdp: desc.sdp });
    }
    if (pc.signalingState === 'stable') this.d.onSettled?.();
  }
}
