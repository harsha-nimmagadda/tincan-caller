type Handle = ReturnType<typeof setTimeout>;

/** Owns every timeout of a session so teardown can clear them all and tests can count leaks. */
export class TimerBag {
  private ids = new Set<Handle>();

  set(fn: () => void, ms: number): Handle {
    const id = setTimeout(() => {
      this.ids.delete(id);
      fn();
    }, ms);
    this.ids.add(id);
    return id;
  }

  clear(id: Handle | null | undefined): void {
    if (id === null || id === undefined) return;
    clearTimeout(id);
    this.ids.delete(id);
  }

  clearAll(): void {
    for (const id of this.ids) clearTimeout(id);
    this.ids.clear();
  }

  get size(): number {
    return this.ids.size;
  }
}
