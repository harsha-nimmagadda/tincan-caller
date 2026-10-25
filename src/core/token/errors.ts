export class TokenError extends Error {
  override name = 'TokenError';
}
/** Structurally invalid token (bad length, range, reserved bit...). */
export class TokenFormatError extends TokenError {
  override name = 'TokenFormatError';
}
export class TokenVersionError extends TokenError {
  override name = 'TokenVersionError';
}
/** "The code looks cut off or mistyped." */
export class TokenCorruptError extends TokenError {
  override name = 'TokenCorruptError';
}
export class TokenKindError extends TokenError {
  override name = 'TokenKindError';
}
/** "This reply code belongs to a different invite." */
export class TokenMismatchError extends TokenError {
  override name = 'TokenMismatchError';
}
