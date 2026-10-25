type Kind = 'audio' | 'video';
const KINDS: Kind[] = ['audio', 'video'];

/**
 * Owns the transceivers and the single remote MediaStream of a session.
 * Local tracks belong to the MediaController; we only `replaceTrack` them.
 */
export class MediaBridge {
  readonly remoteStream = new MediaStream();
  private local: Record<Kind, MediaStreamTrack | null> = { audio: null, video: null };
  private tx: Partial<Record<Kind, RTCRtpTransceiver>> = {};

  private maxVideoBitrate: number | null = null;

  constructor(private readonly pc: RTCPeerConnection) {}

  /** Cap on the video sender (bits/s); null = browser default. Re-applied after each negotiation. */
  async setMaxVideoBitrate(bps: number | null): Promise<void> {
    this.maxVideoBitrate = bps;
    await this.applyBitrate();
  }

  /** The cap currently set on the video sender, for tests and diagnostics. */
  videoMaxBitrate(): number | null {
    return this.tx.video?.sender.getParameters().encodings?.[0]?.maxBitrate ?? null;
  }

  async applyBitrate(): Promise<void> {
    const sender = this.tx.video?.sender;
    const bps = this.maxVideoBitrate;
    if (!sender || bps === null) return;
    try {
      const params = sender.getParameters();
      const enc = params.encodings?.[0];
      // `encodings` is empty until the first negotiation has completed.
      if (!enc || enc.maxBitrate === bps) return;
      enc.maxBitrate = bps;
      await sender.setParameters(params);
    } catch {
      /* some engines reject setParameters before connection; retried after the next negotiation */
    }
  }

  async attachLocal(audio: MediaStreamTrack | null, video: MediaStreamTrack | null): Promise<void> {
    this.local = { audio, video };
    await this.applyLocal();
  }

  /** Caller, once `ctl` is open: this triggers `negotiationneeded`. */
  addCallerTransceivers(): void {
    for (const kind of KINDS) {
      this.tx[kind] ??= this.pc.addTransceiver(kind, { direction: 'sendrecv' });
    }
    void this.applyLocal();
  }

  /** Callee, between applying the remote offer and answering: one round gives two-way media. */
  async prepareForAnswer(): Promise<void> {
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if ((kind === 'audio' || kind === 'video') && t.currentDirection === null && !this.tx[kind]) {
        t.direction = 'sendrecv';
        this.tx[kind] = t;
      }
    }
    await this.applyLocal();
  }

  /** Returns true the first time a remote track is added. */
  handleTrack(track: MediaStreamTrack): boolean {
    if (this.remoteStream.getTracks().includes(track)) return false;
    const first = this.remoteStream.getTracks().length === 0;
    this.remoteStream.addTrack(track);
    return first;
  }

  private async applyLocal(): Promise<void> {
    for (const kind of KINDS) {
      const t = this.tx[kind];
      if (t && t.sender.track !== this.local[kind]) await t.sender.replaceTrack(this.local[kind]);
    }
    await this.applyBitrate();
  }
}
