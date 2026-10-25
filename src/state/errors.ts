import {
  TokenCorruptError,
  TokenError,
  TokenKindError,
  TokenMismatchError,
  TokenVersionError,
} from '../core/token/errors';
import type { Message } from './types';

/** Maps token problems to user-facing messages. `where` says which box the text came from. */
export function tokenErrorMessage(e: unknown, where: 'invite' | 'reply'): Message {
  if (e instanceof TokenKindError) {
    return { key: where === 'invite' ? 'error.replyAsInvite' : 'error.inviteAsReply' };
  }
  if (e instanceof TokenMismatchError) return { key: 'error.wrongInvite' };
  if (e instanceof TokenVersionError) return { key: 'error.version' };
  if (e instanceof TokenCorruptError) return { key: 'error.corrupt' };
  if (e instanceof TokenError) return { key: 'error.badCode' };
  return { key: 'error.unexpected' };
}
