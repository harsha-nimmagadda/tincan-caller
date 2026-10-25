import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env['VITE_BASE'] ?? '/',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
    build: {
      target: 'es2022',
      outDir: mode === 'test' ? 'dist-test' : 'dist',
      rollupOptions: {
        // The debug harness ships only in the e2e (`--mode test`) build, never in production.
        input: { main: 'index.html', ...(mode === 'test' ? { debug: 'src/debug.html' } : {}) },
      },
    },
  };
});
