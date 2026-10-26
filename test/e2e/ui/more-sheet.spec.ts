import { expect, test } from '@playwright/test';
import { closeAll, connect, openApp, tid } from './helpers';

test('More sheet: a focused device select keeps focus while the call screen re-renders', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    await connect(a.page, b.page);
    await tid(a.page, 'btn-more').click();
    const select = tid(a.page, 'sel-videoinput');
    await select.focus();
    await a.page.waitForTimeout(3500); // the timer and stats re-render the call screen every second
    await expect(select).toBeFocused(); // it used to jump to Close, which closes an open dropdown
  } finally {
    await closeAll(a, b);
  }
});
