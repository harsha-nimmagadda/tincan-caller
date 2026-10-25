import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * Content-Security-Policy as a <meta> tag (GitHub Pages cannot set headers). Build only: the dev
 * server needs inline scripts for hot reload. Test builds additionally allow ws://localhost for the
 * mock relay (Phase 6); production never does.
 */
function cspPlugin(isTestBuild: boolean): Plugin {
  const connect = ["'self'", 'wss:', ...(isTestBuild ? ['ws://localhost:*'] : [])].join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'tincan-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const isTest = mode === 'test';
  return {
    base: env['VITE_BASE'] ?? '/',
    // TINCAN_VERSION lets the update test build a second, distinguishable version of the app.
    define: { __APP_VERSION__: JSON.stringify(process.env['TINCAN_VERSION'] ?? pkg.version) },
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === 'https' ? [basicSsl()] : []),
      cspPlugin(isTest),
      VitePWA({
        // A new version waits until the user reloads: an update must never reload a live call.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'favicon.ico', 'icons/apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Tincan',
          short_name: 'Tincan',
          description: 'Serverless peer-to-peer video calls',
          id: './',
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#0b0f14',
          theme_color: '#0b0f14',
          // No `orientation`: calls must work in both portrait and landscape.
          icons: [
            { src: 'icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Includes the lazily loaded QR worker chunk, so scanning also works offline.
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
          navigateFallback: 'index.html',
          // The e2e debug page is its own document, not part of the app shell.
          navigateFallbackDenylist: isTest ? [/\/src\/debug\.html/] : [],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    build: {
      target: 'es2022',
      outDir: process.env['TINCAN_OUT_DIR'] ?? (isTest ? 'dist-test' : 'dist'),
      rollupOptions: {
        // The debug harness ships only in the e2e (`--mode test`) build, never in production.
        input: { main: 'index.html', ...(isTest ? { debug: 'src/debug.html' } : {}) },
      },
    },
  };
});
