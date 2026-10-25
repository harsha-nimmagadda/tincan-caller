// Test builds only. `?fake=1` swaps in fake cameras/microphones (see fake-media.ts) so e2e can
// drive the real UI in every engine; `?mobile=1` makes the media controller act like a phone.
import { call, installMediaOverride } from '../state/services';
import { useStore } from '../state/store';
import { createFakeMediaDevices } from './fake-media';

export async function installTestHooks(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fake =
    params.get('fake') === '1'
      ? createFakeMediaDevices({ deny: params.get('deny') === '1' })
      : null;
  if (fake) installMediaOverride(fake.devices, params.get('mobile') === '1' ? true : null);
  Object.assign(window, {
    __tincan: {
      store: useStore,
      unplug: (id: string) => fake?.unplug(id),
      debug: () => (call.last ?? call.session)?.debugInfo ?? null,
    },
  });
}
