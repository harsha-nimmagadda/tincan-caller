// Verifies the PRODUCTION build (run `pnpm build` first): `node scripts/check-build.mjs [dist]`.
// Hardening and budget checks that unit tests cannot see: CSP, no debug/test code, PWA files, size.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
const INITIAL_JS_BUDGET_GZIP = 180 * 1024; // §11 (the lazy relay chunk is excluded by construction)
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
const read = (f) => readFileSync(join(dist, f), 'utf8');

const html = read('index.html');
// The HTML serializer escapes quotes in attribute values; browsers decode them, so we do too.
const decode = (t) => t.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const csp = decode(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? '');
check(csp !== '', 'index.html has no Content-Security-Policy meta');
for (const d of [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
]) {
  check(csp.includes(d), `CSP missing directive: ${d}`);
}
check(
  !/ws:\/\//.test(csp) && !csp.includes('localhost'),
  'production CSP must not allow ws:// or localhost',
);
check(
  !/script-src[^;]*'unsafe-(inline|eval)'/.test(csp),
  "script-src must not allow 'unsafe-inline' or 'unsafe-eval'",
);
check(html.includes('name="referrer" content="no-referrer"'), 'missing referrer: no-referrer');
check(
  !/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html),
  'index.html contains an inline script (blocked by the CSP)',
);

// Nothing from the test harness may ship.
check(
  !existsSync(join(dist, 'src', 'debug.html')),
  'debug harness page is in the production build',
);
const all = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? all(join(dir, e.name)).map((f) => join(e.name, f)) : [e.name],
  );
const files = all(dist);
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const text = read(f);
  for (const needle of ['Tincan debug harness', 'Fake front camera', 'install-fakes'])
    check(!text.includes(needle), `${f} contains test-only code: ${needle}`);
}

// PWA files.
const manifest = JSON.parse(read('manifest.webmanifest'));
check(
  manifest.display === 'standalone' &&
    manifest.start_url === './' &&
    manifest.scope === './' &&
    manifest.id === './',
  'manifest id/start_url/scope/display wrong',
);
check(manifest.orientation === undefined, 'manifest must not lock orientation');
check(
  manifest.icons?.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'),
  'manifest lacks a 512 maskable icon',
);
for (const i of manifest.icons ?? [])
  check(existsSync(join(dist, i.src)), `manifest icon missing: ${i.src}`);
check(existsSync(join(dist, 'icons/apple-touch-icon-180x180.png')), 'apple-touch-icon missing');
const sw = read('sw.js');
const worker = files.find((f) => /qr-decode\.worker-.*\.js$/.test(f));
check(
  worker !== undefined && sw.includes(worker.replace(/\\/g, '/').split('/').pop()),
  'service worker does not precache the QR worker chunk',
);

// Size budget: scripts the entry HTML loads up front.
const initial = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
check(initial.length > 0, 'found no initial scripts in index.html');
const gz = initial.reduce((n, f) => n + gzipSync(readFileSync(join(dist, f))).length, 0);
check(
  gz <= INITIAL_JS_BUDGET_GZIP,
  `initial JS ${(gz / 1024).toFixed(1)} KB gzip exceeds ${INITIAL_JS_BUDGET_GZIP / 1024} KB`,
);

if (failures.length) {
  console.error(failures.map((f) => `✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log(
  `build ok: CSP strict, no test code, PWA files present, initial JS ${(gz / 1024).toFixed(1)} KB gzip (budget 180)`,
);
