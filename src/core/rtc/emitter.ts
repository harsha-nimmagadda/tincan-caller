/** Tiny typed event emitter. A throwing listener never breaks the others. */
export class Emitter<E extends object> {
  private handlers: { [K in keyof E]?: Set<(value: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, fn: (value: E[K]) => void): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => void this.handlers[event]?.delete(fn);
  }

  emit<K extends keyof E>(event: K, value: E[K]): void {
    for (const fn of [...(this.handlers[event] ?? [])]) {
      try {
        fn(value);
      } catch (e) {
        console.error('listener failed', e);
      }
    }
  }
}
