import { describe, expect, it } from 'vitest';
import {
  buildLink,
  extractToken,
  parseFragment,
  parseTokenInput,
} from '../../src/core/signaling/link';
import { TokenCorruptError, TokenError, TokenKindError } from '../../src/core/token/errors';
import { encodeToken } from '../../src/core/token/token';
import { answer, offer } from './helpers';

const tOffer = encodeToken(offer);
const tAnswer = encodeToken(answer);

describe('link', () => {
  it('parseFragment', () => {
    expect(parseFragment(`#o=${tOffer}`)).toEqual({ kind: 'offer', value: tOffer });
    expect(parseFragment(`a=${tAnswer}`)).toEqual({ kind: 'answer', value: tAnswer });
    expect(parseFragment('#r=abcDEF-_123')).toEqual({ kind: 'relay', value: 'abcDEF-_123' });
    for (const bad of ['', '#', '#x=abc', '#o=', '#o=a b', '#o=abc&x=1', '?o=abc'])
      expect(parseFragment(bad)).toBeNull();
  });
  it('buildLink replaces any existing fragment, never uses a query string', () => {
    const l = buildLink('https://u.github.io/tincan-call/#old', 'offer', tOffer);
    expect(l).toBe(`https://u.github.io/tincan-call/#o=${tOffer}`);
    expect(l).not.toContain('?');
    expect(buildLink('https://x/', 'relay', 'abc')).toBe('https://x/#r=abc');
  });
  it('extracts from raw token, link, and chat text', () => {
    expect(extractToken(tOffer)).toBe(tOffer);
    expect(extractToken(`  \n${tOffer}\n `)).toBe(tOffer);
    expect(extractToken(`https://u.github.io/tincan-call/#o=${tOffer}`)).toBe(tOffer);
    expect(extractToken(`Hey! join me: https://u.github.io/tincan-call/#a=${tAnswer} 👍`)).toBe(
      tAnswer,
    );
    expect(extractToken(`here you go ${tAnswer}. thanks`)).toBe(tAnswer);
    expect(extractToken('hello there, no code in this message')).toBeNull();
    expect(extractToken('x'.repeat(59))).toBeNull();
  });
  it('parseTokenInput decodes and enforces kind', () => {
    expect(parseTokenInput(`see #o=${tOffer}`, 'offer')).toEqual(offer);
    expect(() => parseTokenInput(tAnswer, 'offer')).toThrow(TokenKindError);
    expect(() => parseTokenInput(tOffer, 'answer')).toThrow(TokenKindError);
    expect(() => parseTokenInput('nothing here')).toThrow(TokenCorruptError);
    expect(() => parseTokenInput(tOffer.slice(0, 80))).toThrow(TokenCorruptError);
    expect(() => parseTokenInput('A'.repeat(100))).toThrow(TokenError); // decodes, but is not a token
  });
});
