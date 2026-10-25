import { parseFragment } from '../core/signaling/link';
import { useStore } from './store';

/** Reads an invite/reply/relay link from the address bar, then strips it (it must not linger in history). */
export function bootFromHash(): void {
  const parsed = parseFragment(location.hash);
  if (!parsed) return;
  if (useStore.getState().screen === 'in-call') return; // never hijack a live call
  history.replaceState(null, '', location.pathname + location.search);
  const store = useStore.getState();
  if (parsed.kind === 'offer') store.submitJoinCode(parsed.value);
  else if (parsed.kind === 'answer') void store.openBridge(parsed.value);
  else store.openRelayLink(parsed.value);
}

/** First load: a link in the address bar wins; otherwise a reloaded relay tab rejoins its room. */
export function boot(): void {
  if (parseFragment(location.hash)) bootFromHash();
  else void useStore.getState().resumeRelay();
}
