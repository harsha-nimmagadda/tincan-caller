import { describe, expect, it } from 'vitest';
import { APP_NAME, MAX_CANDIDATES, PROTOCOL_VERSION } from '../../src/config';
import { t } from '../../src/i18n';

describe('config', () => {
  it('exposes the locked constants', () => {
    expect(APP_NAME).toBe('Tincan');
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MAX_CANDIDATES).toBe(12);
  });
  it('t() looks up English strings', () => {
    expect(t('home.start')).toBe('Start a call');
  });
});
