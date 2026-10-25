import { parseFragment } from '../core/signaling/link';
import { useStore } from './store';

/** Reads an invite/reply link from the address bar, then strips it (it must not linger in history). */
export function bootFromHash(): void {
  const parsed = parseFragment(location.hash);
  if (!parsed) return;
  if (useStore.getState().screen === 'in-call') return; // never hijack a live call
  history.replaceState(null, '', location.pathname + location.search);
  const store = useStore.getState();
  if (parsed.kind === 'offer') store.submitJoinCode(parsed.value);
  else if (parsed.kind === 'answer') void store.openBridge(parsed.value);
  else store.toast('toast.relayUnavailable'); // PLAN-NOTE: relay links arrive in Phase 6
}
