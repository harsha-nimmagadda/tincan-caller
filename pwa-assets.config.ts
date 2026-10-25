import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const background = '#0b0f14'; // matches the app's dark theme

// One SVG in, the full icon set out: 64/192/512 PNG, a 512 maskable PNG, apple-touch-icon-180x180 and favicon.ico.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background, fit: 'contain' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background, fit: 'contain' } },
  },
  images: ['public/icons/icon.svg'],
});
