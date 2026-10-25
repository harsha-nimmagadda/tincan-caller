import { decodeToken } from '../token/token';
import { TokenCorruptError } from '../token/errors';
import type { Token, TokenKind } from '../token/types';

export type LinkKind = 'offer' | 'answer' | 'relay';
const PREFIX: Record<LinkKind, string> = { offer: 'o', answer: 'a', relay: 'r' };
const FROM_PREFIX: Record<string, LinkKind> = { o: 'offer', a: 'answer', r: 'relay' };

/** `#o=...` / `#a=...` / `#r=...` → kind + value; anything else → null. */
export function parseFragment(hash: string): { kind: LinkKind; value: string } | null {
  const m = /^#?([oar])=([A-Za-z0-9_-]+)$/.exec(hash);
  const kind = m?.[1] ? FROM_PREFIX[m[1]] : undefined;
  return kind && m?.[2] ? { kind, value: m[2] } : null;
}

export function buildLink(baseUrl: string, kind: LinkKind, value: string): string {
  return `${baseUrl.split('#')[0] ?? ''}#${PREFIX[kind]}=${value}`;
}

/** Finds a token in a raw token, a full link, or a chat message around either (§6.3). */
export function extractToken(input: string): string | null {
  const tagged = /#[oa]=([A-Za-z0-9_-]+)/.exec(input);
  if (tagged?.[1]) return tagged[1];
  return /([A-Za-z0-9_-]{60,700})/.exec(input)?.[1] ?? null;
}

/** Extract + decode user-pasted input; throws a `TokenError` subclass on any problem. */
export function parseTokenInput(input: string, expected?: TokenKind): Token {
  const text = extractToken(input);
  if (!text) throw new TokenCorruptError('no code found — it looks cut off or mistyped');
  return decodeToken(text, expected);
}
