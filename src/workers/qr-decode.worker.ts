import jsQR from 'jsqr';

interface Request {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// The worker global has no DOM typings in this project; describe just what is used.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(msg: { id: number; text: string | null }): void;
};

scope.onmessage = (e) => {
  const { id, width, height, data } = e.data;
  scope.postMessage({ id, text: jsQR(data, width, height)?.data ?? null });
};
