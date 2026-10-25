import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { locale } from './i18n';
import { bootFromHash } from './state/boot';

document.documentElement.lang = locale;

async function main(): Promise<void> {
  // Test builds only: fake cameras/microphones and debug counters (tree-shaken from production).
  if (import.meta.env.MODE === 'test')
    await (await import('./testing/install-fakes')).installTestHooks();
  bootFromHash();
  // A link pasted into the address bar of an open tab only changes the hash (no reload).
  window.addEventListener('hashchange', bootFromHash);
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
