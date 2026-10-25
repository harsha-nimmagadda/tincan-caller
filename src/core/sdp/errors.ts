export class SdpParseError extends Error {
  override name = 'SdpParseError';
}
export class UnsupportedFingerprintError extends SdpParseError {
  override name = 'UnsupportedFingerprintError';
}
