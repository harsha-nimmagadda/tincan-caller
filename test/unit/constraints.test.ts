import { describe, expect, it } from 'vitest';
import {
  audioConstraints,
  maxBitrate,
  QUALITY_PROFILES,
  videoConstraints,
} from '../../src/core/media/constraints';
import { applySink, parseDevices, supportsSinkId } from '../../src/core/media/devices';
import { vi } from 'vitest';

describe('quality presets → video constraints', () => {
  it('auto = 720p30 (landscape)', () => {
    expect(videoConstraints('auto', { portrait: false })).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30 },
    });
  });
  it('data-saver = 360p15, high = 1080p30', () => {
    expect(videoConstraints('data-saver', { portrait: false })).toMatchObject({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15 },
    });
    expect(videoConstraints('high', { portrait: false })).toMatchObject({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  });
  it('portrait swaps the dimensions and the aspect ratio for every preset', () => {
    for (const q of ['auto', 'data-saver', 'high'] as const) {
      const land = QUALITY_PROFILES[q].landscape;
      expect(videoConstraints(q, { portrait: true })).toMatchObject({
        width: { ideal: land.height },
        height: { ideal: land.width },
        aspectRatio: { ideal: 9 / 16 },
      });
    }
  });
  it('facingMode: ideal by default, exact when asked', () => {
    expect(videoConstraints('auto', { portrait: false, facingMode: 'user' }).facingMode).toEqual({
      ideal: 'user',
    });
    expect(
      videoConstraints('auto', { portrait: false, facingMode: 'environment', exactFacing: true })
        .facingMode,
    ).toEqual({ exact: 'environment' });
    expect(videoConstraints('auto', { portrait: false }).facingMode).toBeUndefined();
  });
  it('an explicit deviceId wins over facingMode (they conflict)', () => {
    const c = videoConstraints('auto', { portrait: false, deviceId: 'cam1', facingMode: 'user' });
    expect(c.deviceId).toEqual({ exact: 'cam1' });
    expect(c.facingMode).toBeUndefined();
  });
  it('sender bitrate caps: auto 1.5 Mbps, data-saver 300 kbps, high 2.5 Mbps', () => {
    expect([maxBitrate('auto'), maxBitrate('data-saver'), maxBitrate('high')]).toEqual([
      1_500_000, 300_000, 2_500_000,
    ]);
  });
});

describe('audio constraints', () => {
  it('turn on echo cancellation, noise suppression and AGC', () => {
    expect(audioConstraints()).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(audioConstraints('mic1').deviceId).toEqual({ exact: 'mic1' });
  });
});

describe('devices', () => {
  it('groups by kind and ignores unknown kinds', () => {
    const d = parseDevices([
      { kind: 'audioinput', deviceId: 'a', label: 'Mic' },
      { kind: 'videoinput', deviceId: 'v', label: '' },
      { kind: 'audiooutput', deviceId: 's', label: 'Spk' },
      { kind: 'other', deviceId: 'x', label: '' },
    ]);
    expect(d.audioinput).toEqual([{ deviceId: 'a', label: 'Mic' }]);
    expect(d.videoinput).toEqual([{ deviceId: 'v', label: '' }]);
    expect(d.audiooutput).toHaveLength(1);
  });
  it('setSinkId is feature-detected', async () => {
    expect(supportsSinkId()).toBe(false);
    expect(await applySink({} as HTMLMediaElement, 'x')).toBe(false);
    class FakeMedia {
      sink = '';
      async setSinkId(id: string) {
        if (id === 'bad') throw new Error('no');
        this.sink = id;
      }
    }
    vi.stubGlobal('HTMLMediaElement', FakeMedia);
    const el = new FakeMedia();
    expect(supportsSinkId()).toBe(true);
    expect(await applySink(el as unknown as HTMLMediaElement, 'spk')).toBe(true);
    expect(el.sink).toBe('spk');
    expect(await applySink(el as unknown as HTMLMediaElement, 'bad')).toBe(false);
    expect(await applySink(el as unknown as HTMLMediaElement, undefined)).toBe(false);
    vi.unstubAllGlobals();
  });
});
