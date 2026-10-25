/** Decodes QR codes from a canvas. Two engines behind one interface: native, or jsQR in a worker. */
export interface QrDecoder {
  decode(canvas: HTMLCanvasElement): Promise<string | null>;
  dispose(): void;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};

async function nativeDecoder(): Promise<QrDecoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    if (!(await Ctor.getSupportedFormats()).includes('qr_code')) return null;
    const detector = new Ctor({ formats: ['qr_code'] });
    return {
      decode: async (canvas) => (await detector.detect(canvas))[0]?.rawValue ?? null,
      dispose: () => undefined,
    };
  } catch {
    return null;
  }
}

function workerDecoder(): QrDecoder {
  // Lazy: the worker (and jsQR inside it) is only fetched when scanning actually starts.
  const worker = new Worker(new URL('../../workers/qr-decode.worker.ts', import.meta.url), {
    type: 'module',
  });
  let nextId = 1;
  const waiting = new Map<number, (text: string | null) => void>();
  worker.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
    waiting.get(e.data.id)?.(e.data.text);
    waiting.delete(e.data.id);
  };
  return {
    decode: (canvas) =>
      new Promise((resolve) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx || canvas.width === 0 || canvas.height === 0) return resolve(null);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const id = nextId++;
        waiting.set(id, resolve);
        worker.postMessage({ id, width: img.width, height: img.height, data: img.data }, [
          img.data.buffer,
        ]);
      }),
    dispose: () => {
      worker.terminate();
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
    },
  };
}

export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? workerDecoder();
}

const MAX_SIDE = 800;

function draw(canvas: HTMLCanvasElement, source: CanvasImageSource, w: number, h: number): void {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas
    .getContext('2d', { willReadFrequently: true })
    ?.drawImage(source, 0, 0, canvas.width, canvas.height);
}

/** Decode a QR from an uploaded picture. Returns null when none is found. */
export async function decodeImageFile(file: File): Promise<string | null> {
  const decoder = await createQrDecoder();
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    draw(canvas, bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return await decoder.decode(canvas);
  } catch {
    return null;
  } finally {
    decoder.dispose();
  }
}

export type ScanFailure = 'permission-denied' | 'no-camera' | 'unknown';

/**
 * Camera scanner: ~8 frames/s into an offscreen canvas. Pass `reuse` to scan with an already-open
 * camera stream (desktop); we then leave that stream alone on stop. Otherwise we open our own
 * back-camera stream and always release it on stop.
 */
export class QrScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private own: MediaStream | null = null;
  private decoder: QrDecoder | null = null;
  private busy = false;
  private stopped = false;

  async start(
    video: HTMLVideoElement,
    onResult: (text: string) => void,
    reuse: MediaStream | null,
  ): Promise<ScanFailure | null> {
    try {
      this.decoder = await createQrDecoder();
      const stream =
        reuse ??
        (this.own = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        }));
      if (this.stopped) return (this.stop(), null);
      video.srcObject = stream;
      video.muted = true;
      await video.play().catch(() => undefined);
    } catch (e) {
      this.stop();
      const name = e instanceof DOMException ? e.name : '';
      return name === 'NotAllowedError'
        ? 'permission-denied'
        : name === 'NotFoundError'
          ? 'no-camera'
          : 'unknown';
    }
    const canvas = document.createElement('canvas');
    this.timer = setInterval(() => {
      if (this.busy || !this.decoder || video.videoWidth === 0) return;
      this.busy = true;
      draw(canvas, video, video.videoWidth, video.videoHeight);
      void this.decoder
        .decode(canvas)
        .then((text) => {
          if (text && !this.stopped) onResult(text);
        })
        .catch(() => undefined)
        .finally(() => (this.busy = false));
    }, 125);
    return null;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.own?.getTracks() ?? []) t.stop();
    this.own = null;
    this.decoder?.dispose();
    this.decoder = null;
  }
}
