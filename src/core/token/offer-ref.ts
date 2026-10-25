import { sha256, utf8 } from '../encoding/bytes';

/** First 4 bytes of SHA-256("<ufrag>:<pwd>") of the *offer*; ties an answer to its invite. */
export async function computeOfferRef(ufrag: string, pwd: string): Promise<Uint8Array> {
  return (await sha256(utf8(`${ufrag}:${pwd}`))).slice(0, 4);
}
