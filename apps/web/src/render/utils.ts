/** Lightweight render-layer utilities — no framework deps. */

export function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Percentile over a sorted numeric array. */
export function percentile(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx] ?? 0;
}

export function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Circular buffer — fixed capacity, evicts oldest on overflow. */
export class CircularBuffer<T> {
  private readonly _buf: Array<T | undefined>;
  private _head: number = 0;
  private _size: number = 0;

  constructor(readonly capacity: number) {
    this._buf = new Array<T | undefined>(capacity).fill(undefined);
  }

  push(item: T): void {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  toArray(): ReadonlyArray<T> {
    const result: T[] = [];
    const start = this._size < this.capacity ? 0 : this._head;
    for (let i = 0; i < this._size; i++) {
      const item = this._buf[(start + i) % this.capacity];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this._buf.fill(undefined);
    this._head = 0;
    this._size = 0;
  }
}
