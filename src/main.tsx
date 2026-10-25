import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { locale } from './i18n';
import { bootFromHash } from './state/boot';

document.documentElement.lang = locale;

function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true; // reading a cross-origin parent can throw: that is also "framed"
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  if (isFramed()) {
    // Clickjacking defence (§9): render only a link out. No media, no links read, no calls.
    const { FrameBlocked } = await import('./ui/screens/FrameBlocked');
    createRoot(root).render(<FrameBlocked />);
    return;
  }
  // Test builds only: fake cameras/microphones and debug counters (tree-shaken from production).
  if (import.meta.env.MODE === 'test')
    await (await import('./testing/install-fakes')).installTestHooks();
  bootFromHash();
  // A link pasted into the address bar of an open tab only changes the hash (no reload).
  window.addEventListener('hashchange', bootFromHash);
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
