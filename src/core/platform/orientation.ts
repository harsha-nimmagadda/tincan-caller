/** Is the device held upright? screen.orientation → matchMedia → viewport shape. */
export function isPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  if (type) return type.startsWith('portrait');
  if (typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(orientation: portrait)');
    if (typeof mql?.matches === 'boolean') return mql.matches;
  }
  return window.innerHeight > window.innerWidth;
}

export function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}
