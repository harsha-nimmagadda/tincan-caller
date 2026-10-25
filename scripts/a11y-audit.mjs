// Lighthouse accessibility audit of every screen/state, using Lighthouse "snapshot" mode driven by
// Playwright (the screens only exist mid-call, so a URL-based audit cannot reach them).
//
// Lighthouse and puppeteer-core are NOT project dependencies. Run from a scratch directory:
//   pnpm build:test && pnpm preview:test &                       # serves http://localhost:4173
//   D=$(mktemp -d) && cd "$D" && npm init -y && npm i lighthouse puppeteer-core
//   cp <repo>/scripts/a11y-audit.mjs . && TINCAN_ROOT=<repo> node a11y-audit.mjs
// Target (PLAN Phase 4): accessibility >= 95 on every step. Last run: 100 on all 12.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  pathToFileURL(
    join(process.env.TINCAN_ROOT ?? process.cwd(), 'node_modules/@playwright/test/index.mjs'),
  ).href
);
import puppeteer from 'puppeteer-core';
import { startFlow } from 'lighthouse';

const base = process.env.BASE ?? 'http://localhost:4173';
const PORT = 9333;
const browser = await chromium.launch({
  args: [
    `--remote-debugging-port=${PORT}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
});
const settings = JSON.stringify({ stun: [] });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 } });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['tincan.settings.v1', settings]);
  return ctx.newPage();
};
const tid = (p, id) => p.getByTestId(id);
const a = await mk();
await a.goto(`${base}/?fake=1`);
const b = await mk();
await b.goto(`${base}/?fake=1`);

const pp = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${PORT}`,
  defaultViewport: null,
});
const handleFor = async (pw) => {
  const url = pw.url();
  const marker = `lh-${Math.random()}`;
  await pw.evaluate((m) => (window.name = m), marker);
  for (const p of await pp.pages()) {
    if ((await p.evaluate(() => window.name).catch(() => '')) === marker) return p;
  }
  throw new Error('page not found ' + url);
};
const pa = await handleFor(a);
const flow = await startFlow(pa, {
  config: {
    extends: 'lighthouse:default',
    settings: { onlyCategories: ['accessibility'], screenEmulation: { disabled: true } },
  },
});

const snap = async (name) => {
  await a.waitForTimeout(300);
  await flow.snapshot({ name });
};

await snap('home');
await tid(a, 'join-toggle').click();
await tid(a, 'join-input').fill('hello');
await snap('home + join panel + error');
await tid(a, 'join-input').fill('');
await tid(a, 'open-settings').click();
await snap('settings');
await tid(a, 'settings-back').click();
await tid(a, 'open-about').click();
await snap('about');
await tid(a, 'about-back').click();
await tid(a, 'start-call').click();
await tid(a, 'lobby-continue').waitFor({ state: 'visible' });
await a.waitForFunction(() => !document.querySelector('[data-testid="lobby-continue"]').disabled);
await snap('lobby');
await tid(a, 'lobby-continue').click();
await tid(a, 'invite-qr').waitFor();
await tid(a, 'invite-code').evaluate((el) => el.closest('details').setAttribute('open', ''));
await snap('create (invite + reply)');
const link = await tid(a, 'invite-qr').getAttribute('data-link');
await b.goto(link.replace('#', '?fake=1#'));
await tid(b, 'lobby-continue').waitFor();
await b.waitForFunction(() => !document.querySelector('[data-testid="lobby-continue"]').disabled);
await tid(b, 'lobby-continue').click();
await tid(b, 'reply-qr').waitFor();
const reply = await tid(b, 'reply-qr').getAttribute('data-link');
await tid(a, 'reply-input').fill(reply);
await a.waitForFunction(
  () => document.querySelector('[data-testid="call-state"]').dataset.state === 'connected',
  null,
  { timeout: 30000 },
);
await snap('in call');
await tid(a, 'btn-more').click();
await snap('in call: more sheet');
await a.keyboard.press('Escape');
await tid(a, 'sas-badge').click();
await snap('in call: safety dialog');
await a.keyboard.press('Escape');
await a.keyboard.press('s');
await a.waitForTimeout(1500);
await snap('in call: stats hud');
await a.keyboard.press('s');
await a.keyboard.press('Control+d');
await snap('in call: end confirm');
await a.keyboard.press('Escape');
await tid(a, 'btn-hangup').click();
await tid(a, 'ended-reason').waitFor();
await snap('ended');

const result = await flow.createFlowResult();
let min = 100;
for (const step of result.steps) {
  const score = Math.round((step.lhr.categories.accessibility?.score ?? 0) * 100);
  min = Math.min(min, score);
  console.log(String(score).padStart(3), step.name);
  for (const [id, audit] of Object.entries(step.lhr.audits)) {
    if (audit.score !== null && audit.score < 1 && audit.scoreDisplayMode === 'binary') {
      const items = (audit.details?.items ?? [])
        .slice(0, 3)
        .map((i) => i.node?.snippet ?? i.node?.selector ?? '')
        .join(' | ');
      console.log(`      ✗ ${id}: ${audit.title} :: ${items.slice(0, 220)}`);
    }
  }
}
console.log('MIN', min);
process.exitCode = min >= 95 ? 0 : 1;
await pp.disconnect();
await browser.close();
