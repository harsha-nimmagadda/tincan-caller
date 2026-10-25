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

  constructor(private readonly pc: RTCPeerConnection) {}

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
  }
}
