export type CandidateType = 'host' | 'srflx' | 'relay' | 'prflx';
export type SetupRole = 'actpass' | 'active' | 'passive';
export type TokenKind = 'offer' | 'answer';

export interface TokenCandidate {
  type: CandidateType;
  family: 'ipv4' | 'ipv6' | 'mdns';
  /** ipv4 dotted, ipv6 compressed lowercase, or `<uuid>.local` lowercase. */
  address: string;
  port: number;
}

/** The ICE/DTLS facts of one side, as carried by a token and rebuilt into SDP. */
export interface IceDescription {
  setup: SetupRole;
  mid: string;
  ufrag: string;
  pwd: string;
  sessId: string;
  sessVersion: number;
  /** Raw SHA-256 DTLS fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  candidates: TokenCandidate[];
}

export interface Token extends IceDescription {
  kind: TokenKind;
  /** Answer only: 16 bytes, SHA-256(callee nonce)[0..16]. */
  commit?: Uint8Array;
  /** Answer only: 4 bytes, SHA-256("<offer ufrag>:<offer pwd>")[0..4]. */
  offerRef?: Uint8Array;
}
