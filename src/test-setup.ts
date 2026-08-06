class MemoryStorage implements Storage {
  #store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, String(value))
  }

  removeItem(key: string): void {
    this.#store.delete(key)
  }

  clear(): void {
    this.#store.clear()
  }

  key(index: number): string | null {
    return [...this.#store.keys()][index] ?? null
  }

  get length(): number {
    return this.#store.size
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() })
}
