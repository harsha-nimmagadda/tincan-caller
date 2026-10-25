import { decodeBase64Url, encodeBase64Url } from '../../encoding/base64url';
import { concatBytes, fromUtf8, randomBytes, toHex, utf8 } from '../../encoding/bytes';
import { guardRelayMsg, type RelayMsg } from './messages';

const SALT = utf8('tincan-relay-v1');
const IV_BYTES = 12;
const subtle = () => globalThis.crypto.subtle;

export interface Room {
  /** Public: relays can see it. 32 hex chars. */
  roomTag: string;
  /** Never leaves the device. */
  key: CryptoKey;
}

/** HKDF-SHA-256(secret, salt = "tincan-relay-v1", info = "room" | "enc") — §7.1. */
export async function deriveRoom(secret: Uint8Array): Promise<Room> {
  const base = await subtle().importKey('raw', secret as BufferSource, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const params = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: SALT as BufferSource,
    info: utf8(info) as BufferSource,
  });
  const tag = new Uint8Array(await subtle().deriveBits(params('room'), base, 128));
  const key = await subtle().deriveKey(
    params('enc'),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { roomTag: toHex(tag), key };
}

/** content = base64url(iv(12) ‖ AES-GCM ciphertext) */
export async function encryptMsg(key: CryptoKey, msg: RelayMsg): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      utf8(JSON.stringify(msg)) as BufferSource,
    ),
  );
  return encodeBase64Url(concatBytes(iv, ct));
}

/** Wrong key, tampering, truncation, junk or an invalid message → null. Never throws. */
export async function decryptMsg(key: CryptoKey, content: string): Promise<RelayMsg | null> {
  try {
    const bytes = decodeBase64Url(content);
    if (!bytes || bytes.length <= IV_BYTES + 16) return null;
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) as BufferSource },
      key,
      bytes.slice(IV_BYTES) as BufferSource,
    );
    return guardRelayMsg(JSON.parse(fromUtf8(new Uint8Array(plain))) as unknown);
  } catch {
    return null;
  }
}
