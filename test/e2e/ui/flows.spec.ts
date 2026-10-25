import { expect, test, type Page } from '@playwright/test';
import {
  closeAll,
  enterReply,
  expectInCall,
  finishJoin,
  joinFromLink,
  openApp,
  startAsCaller,
  tid,
  withFake,
} from './helpers';

const err = (p: Page) => tid(p, 'error-panel');

test('3. errors: truncated, wrong kind, and a reply for a different invite — all recoverable', async ({
  baseURL,
}) => {
  const a1 = await openApp('chromium', baseURL ?? '');
  const a2 = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    const invite1 = await startAsCaller(a1.page);
    const invite2 = await startAsCaller(a2.page);
    const reply1 = await joinFromLink(b.page, invite1.link);

    await enterReply(a1.page, reply1.code.slice(0, 90)); // cut off
    await expect(err(a1.page)).toHaveAttribute('data-error', 'error.corrupt');

    await enterReply(a1.page, 'abc');
    await expect(err(a1.page)).toHaveAttribute('data-error', 'error.corrupt');

    await enterReply(a1.page, invite1.code); // an invite where a reply belongs
    await expect(err(a1.page)).toHaveAttribute('data-error', 'error.inviteAsReply');

    const other = await joinFromLink(await await a2.context.newPage(), invite2.link).catch(
      () => null,
    );
    expect(other).not.toBeNull();
    await enterReply(a1.page, other?.code ?? ''); // reply to a different invite
    await expect(err(a1.page)).toHaveAttribute('data-error', 'error.wrongInvite');

    // None of that broke the session: the right reply still connects.
    await enterReply(a1.page, reply1.link);
    await expectInCall(a1.page, b.page);
  } finally {
    await closeAll(a1, a2, b);
  }
});

test('3b. join box: a reply or garbage is rejected with a specific message', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  const c = await openApp('chromium', baseURL ?? '');
  try {
    const invite = await startAsCaller(a.page);
    const reply = await joinFromLink(b.page, invite.link);
    await tid(c.page, 'join-toggle').click();
    await tid(c.page, 'join-input').fill(reply.code);
    await expect(err(c.page)).toHaveAttribute('data-error', 'error.replyAsInvite');
    await tid(c.page, 'join-input').fill('hello, not a code');
    await expect(err(c.page)).toHaveAttribute('data-error', 'error.corrupt');
    await tid(c.page, 'join-input').fill(`my chat message: ${invite.link} see you`); // code inside chat text
    await expect(tid(c.page, 'lobby-continue')).toBeVisible();
  } finally {
    await closeAll(a, b, c);
  }
});

for (const engine of ['chromium', 'firefox'] as const) {
  test(`QR codes (${engine}): invite and reply are scanned from pictures, end to end`, async ({
    baseURL,
  }) => {
    const a = await openApp(engine, baseURL ?? '');
    const b = await openApp(engine, baseURL ?? '');
    try {
      await startAsCaller(a.page);
      const inviteQr = await tid(a.page, 'invite-qr').screenshot();

      await tid(b.page, 'join-toggle').click();
      await tid(b.page, 'join-scan').click();
      await tid(b.page, 'qr-upload').setInputFiles({
        name: 'invite.png',
        mimeType: 'image/png',
        buffer: inviteQr,
      });
      await finishJoin(b.page);
      const replyQr = await tid(b.page, 'reply-qr').screenshot();

      await tid(a.page, 'reply-scan').click();
      await tid(a.page, 'qr-upload').setInputFiles({
        name: 'reply.png',
        mimeType: 'image/png',
        buffer: replyQr,
      });
      await expectInCall(a.page, b.page);
    } finally {
      await closeAll(a, b);
    }
  });
}

test('QR: a picture without a QR code says so', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '');
  try {
    await tid(a.page, 'join-toggle').click();
    await tid(a.page, 'join-scan').click();
    const blank = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await tid(a.page, 'qr-upload').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: blank,
    });
    await expect(a.page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
    await a.page.keyboard.press('Escape');
    await expect(tid(a.page, 'qr-scanner')).toBeHidden();
  } finally {
    await closeAll(a);
  }
});

test('tab bridge: opening the reply link in another tab of the caller’s browser completes the call', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('firefox', baseURL ?? '');
  try {
    const invite = await startAsCaller(a.page);
    const reply = await joinFromLink(b.page, invite.link);
    const tab = await a.context.newPage();
    await tab.goto(reply.link);
    await expect(tid(tab, 'bridge')).toHaveAttribute('data-status', 'done');
    await expectInCall(a.page, b.page);
  } finally {
    await closeAll(a, b);
  }
});

test('tab bridge: with no caller tab listening, the opened tab shows the code to paste', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  const elsewhere = await openApp('chromium', baseURL ?? ''); // a different browser, like iOS PWA vs Safari
  try {
    const invite = await startAsCaller(a.page);
    const reply = await joinFromLink(b.page, invite.link);
    await elsewhere.page.goto(reply.link);
    await expect(tid(elsewhere.page, 'bridge')).toHaveAttribute('data-status', 'manual');
    await expect(tid(elsewhere.page, 'bridge-code')).toHaveValue(reply.code);
    await enterReply(a.page, await tid(elsewhere.page, 'bridge-code').inputValue()); // paste it where the call started
    await expectInCall(a.page, b.page);
  } finally {
    await closeAll(a, b, elsewhere);
  }
});

test('the link fragment is stripped from the address bar once read', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    const invite = await startAsCaller(a.page);
    await b.page.goto(withFake(invite.link));
    await expect(tid(b.page, 'lobby-continue')).toBeVisible();
    expect(new URL(b.page.url()).hash).toBe('');
    expect(b.page.url()).not.toContain('o=');
  } finally {
    await closeAll(a, b);
  }
});

test('keyboard shortcuts, stats overlay, and the end-call confirmation', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    const invite = await startAsCaller(a.page);
    await enterReply(a.page, (await joinFromLink(b.page, invite.link)).link);
    await expectInCall(a.page, b.page);

    await a.page.keyboard.press('m');
    await expect(tid(a.page, 'btn-mic')).toHaveAttribute('aria-pressed', 'true');
    await expect(tid(b.page, 'remote-mic-off')).toBeVisible();
    await a.page.keyboard.press('v');
    await expect(tid(a.page, 'btn-cam')).toHaveAttribute('aria-pressed', 'true');
    await expect(tid(b.page, 'remote-cam-off')).toBeVisible();

    await expect(tid(a.page, 'stats-hud')).toHaveCount(0);
    await a.page.keyboard.press('s');
    await expect(tid(a.page, 'stats-hud')).toBeVisible();
    await expect(tid(a.page, 'stats-hud')).toContainText(/\d/, { timeout: 8000 }); // real numbers arrive
    await a.page.keyboard.press('s');
    await expect(tid(a.page, 'stats-hud')).toHaveCount(0);

    await a.page.keyboard.press('Control+d');
    await expect(tid(a.page, 'confirm-end')).toBeVisible();
    await a.page.keyboard.press('Escape');
    await expect(tid(a.page, 'confirm-end')).toBeHidden();
    await expect(tid(a.page, 'call-state')).toHaveAttribute('data-state', 'connected');

    await a.page.keyboard.press('Control+d');
    await tid(a.page, 'confirm-end-yes').click();
    await expect(tid(a.page, 'ended-reason')).toHaveAttribute('data-reason', 'local-hangup');
    await expect(tid(b.page, 'ended-reason')).toHaveAttribute('data-reason', 'remote-hangup');
  } finally {
    await closeAll(a, b);
  }
});

test('Back during a call asks first instead of leaving; closing the tab warns', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  const b = await openApp('chromium', baseURL ?? '');
  try {
    const invite = await startAsCaller(a.page);
    await enterReply(a.page, (await joinFromLink(b.page, invite.link)).link);
    await expectInCall(a.page, b.page);

    await a.page.goBack();
    await expect(tid(a.page, 'confirm-end')).toBeVisible();
    await expect(tid(a.page, 'call-state')).toHaveAttribute('data-state', 'connected');
    await a.page.keyboard.press('Escape');

    const dialog = a.page.waitForEvent('dialog');
    void a.page.close({ runBeforeUnload: true });
    expect((await dialog).type()).toBe('beforeunload');
    await (await dialog).dismiss();
  } finally {
    await closeAll(a, b);
  }
});

test('a denied camera/microphone shows help instead of a dead end', async ({ baseURL }) => {
  const a = await openApp('chromium', baseURL ?? '', { query: 'fake=1&deny=1' });
  try {
    await tid(a.page, 'start-call').click();
    await expect(tid(a.page, 'permission-help')).toBeVisible();
    await expect(err(a.page)).toHaveAttribute('data-error', 'perm.denied');
    await expect(tid(a.page, 'lobby-continue')).toHaveCount(0);
  } finally {
    await closeAll(a);
  }
});

test('lobby: device pickers list the cameras and the quality choice is remembered', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '');
  try {
    await tid(a.page, 'start-call').click();
    await expect(tid(a.page, 'lobby-continue')).toBeEnabled({ timeout: 15_000 });
    await expect(tid(a.page, 'sel-videoinput').locator('option')).toHaveCount(2);
    await tid(a.page, 'sel-quality').selectOption('data-saver');
    await a.page.reload();
    await tid(a.page, 'start-call').click();
    await expect(tid(a.page, 'sel-quality')).toHaveValue('data-saver');
  } finally {
    await closeAll(a);
  }
});

test('settings persist across reloads and reset restores the defaults; About links to the source', async ({
  baseURL,
}) => {
  const a = await openApp('chromium', baseURL ?? '', {
    settings: { stun: ['stun:stun.l.google.com:19302'] },
  });
  try {
    await tid(a.page, 'open-settings').click();
    await tid(a.page, 'stun-input').fill('stun:a.example:3478\nnot-a-stun-line');
    await expect(a.page.getByRole('alert')).toContainText('1');
    await tid(a.page, 'show-stats').check();
    await a.page.reload();
    await tid(a.page, 'open-settings').click();
    await expect(tid(a.page, 'stun-input')).toHaveValue('stun:a.example:3478');
    await expect(tid(a.page, 'show-stats')).toBeChecked();
    await tid(a.page, 'reset-settings').click();
    await expect(tid(a.page, 'stun-input')).toHaveValue(/stun\.l\.google\.com/);
    await expect(tid(a.page, 'show-stats')).not.toBeChecked();
    await tid(a.page, 'settings-back').click();
    await tid(a.page, 'open-about').click();
    await expect(tid(a.page, 'source-link')).toHaveAttribute('href', /^https:\/\//);
    await expect(tid(a.page, 'app-version')).not.toBeEmpty();
  } finally {
    await closeAll(a);
  }
});
