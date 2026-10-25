import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { t } from '../../src/i18n';
import { tokenErrorMessage } from '../../src/state/errors';
import { useStore } from '../../src/state/store';
import { formatDuration } from '../../src/ui/format';
import {
  TokenCorruptError,
  TokenError,
  TokenKindError,
  TokenMismatchError,
  TokenVersionError,
} from '../../src/core/token/errors';

describe('error messages', () => {
  it('map every token error to a specific key, depending on where the text came from', () => {
    expect(tokenErrorMessage(new TokenKindError('x'), 'reply').key).toBe('error.inviteAsReply');
    expect(tokenErrorMessage(new TokenKindError('x'), 'invite').key).toBe('error.replyAsInvite');
    expect(tokenErrorMessage(new TokenMismatchError('x'), 'reply').key).toBe('error.wrongInvite');
    expect(tokenErrorMessage(new TokenVersionError('x'), 'reply').key).toBe('error.version');
    expect(tokenErrorMessage(new TokenCorruptError('x'), 'reply').key).toBe('error.corrupt');
    expect(tokenErrorMessage(new TokenError('x'), 'reply').key).toBe('error.badCode');
    expect(tokenErrorMessage(new Error('x'), 'reply').key).toBe('error.unexpected');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75_000)).toBe('1:15');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('strings', () => {
  it('none is empty and placeholders are well formed', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, key).toBeGreaterThan(0);
      expect(value.replace(/\{\w+\}/g, '').includes('{'), key).toBe(false);
    }
  });
  it('interpolates parameters and leaves unknown ones visible', () => {
    expect(t('create.age', { minutes: 7 })).toBe('This invite is 7 minutes old.');
    expect(t('create.age')).toContain('{minutes}');
  });
});

describe('store (no DOM)', () => {
  it('toasts: capped at three, dismissible', () => {
    const s = useStore.getState();
    for (let i = 0; i < 5; i++) s.toast('toast.copied');
    expect(useStore.getState().toasts).toHaveLength(3);
    const first = useStore.getState().toasts[0];
    useStore.getState().dismissToast(first?.id ?? -1);
    expect(useStore.getState().toasts).toHaveLength(2);
  });
  it('a bad invite keeps you on Home with a specific error, and it can be cleared', () => {
    expect(useStore.getState().submitJoinCode('this is not a code')).toBe(false);
    expect(useStore.getState().joinError?.key).toBe('error.corrupt');
    expect(useStore.getState().screen).toBe('home');
    useStore.getState().clearJoinError();
    expect(useStore.getState().joinError).toBeNull();
  });
  it('settings changes apply immediately; failing to persist is reported, not fatal', () => {
    useStore.getState().updateSettings({ quality: 'high' });
    expect(useStore.getState().settings.quality).toBe('high');
    expect(useStore.getState().toasts.some((x) => x.key === 'toast.settingsNotSaved')).toBe(true); // no localStorage in node
    useStore.getState().resetSettings();
    expect(useStore.getState().settings.quality).toBe('auto');
  });
  it('navigation between plain screens', () => {
    useStore.getState().go('settings');
    expect(useStore.getState().screen).toBe('settings');
    useStore.getState().go('home');
    expect(useStore.getState().screen).toBe('home');
  });
});
