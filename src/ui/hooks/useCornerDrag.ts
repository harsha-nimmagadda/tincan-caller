import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Drag a tile freely, then snap it to the nearest corner of its container on release. */
export function useCornerDrag(container: RefObject<HTMLElement | null>, initial: Corner = 'br') {
  const [corner, setCorner] = useState<Corner>(initial);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (s) setOffset({ x: e.clientX - s.x, y: e.clientY - s.y });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    start.current = null;
    const box = container.current?.getBoundingClientRect();
    if (box) {
      const x = e.clientX - box.left > box.width / 2 ? 'r' : 'l';
      const y = e.clientY - box.top > box.height / 2 ? 'b' : 't';
      setCorner(`${y}${x}` as Corner);
    }
    setOffset(null);
  };
  return {
    corner,
    offset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
