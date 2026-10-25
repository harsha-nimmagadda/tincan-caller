import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env['VITE_BASE'] ?? '/',
    plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
    build: { target: 'es2022' },
  };
});
