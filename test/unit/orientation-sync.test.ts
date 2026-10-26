import { describe, expect, it, vi } from 'vitest';
import { MediaController, type MediaDevicesLike } from '../../src/core/media/media-controller';

/** A camera that returns `shape` no matter what is asked, until applyConstraints changes it. */
function setup(shape: { width: number; height: number }, portrait: boolean) {
  const apply = vi.fn(async (c: MediaTrackConstraints) => {
    const w = (c.width as { ideal: number }).ideal;
    const h = (c.height as { ideal: number }).ideal;
    shape = { width: w, height: h };
  });
  const video = {
    kind: 'video',
    readyState: 'live',
    enabled: true,
    stop() {},
    getSettings: () => ({ ...shape, facingMode: 'user' }),
    applyConstraints: apply,
    addEventListener() {},
    removeEventListener() {},
  };
  const audio = { ...video, kind: 'audio', getSettings: () => ({}) };
  const mediaDevices: MediaDevicesLike = {
    getUserMedia: async (c) =>
      ({
        getAudioTracks: () => (c.audio ? [audio] : []),
        getVideoTracks: () => (c.video ? [video] : []),
      }) as unknown as MediaStream,
    enumerateDevices: async () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const mc = new MediaController({
    mediaDevices,
    visibility: null,
    isMobile: () => true,
    isPortrait: () => portrait,
  });
  return { mc, apply };
}

describe('syncOrientation', () => {
  it('asks for a portrait picture when the phone is upright but the camera gave landscape', async () => {
    const { mc, apply } = setup({ width: 1280, height: 720 }, true);
    await mc.start({ video: true });
    await mc.syncOrientation();
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ width: { ideal: 720 }, height: { ideal: 1280 } }),
    );
  });

  it('leaves a picture alone when its shape already matches', async () => {
    const { mc, apply } = setup({ width: 720, height: 1280 }, true);
    await mc.start({ video: true });
    await mc.syncOrientation();
    expect(apply).not.toHaveBeenCalled();
  });

  it('asks for landscape when the phone is held sideways and the camera gave portrait', async () => {
    const { mc, apply } = setup({ width: 720, height: 1280 }, false);
    await mc.start({ video: true });
    await mc.syncOrientation();
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ width: { ideal: 1280 }, height: { ideal: 720 } }),
    );
  });
});
