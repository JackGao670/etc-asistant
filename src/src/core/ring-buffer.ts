export class ByteRing<T> {
  private items: Array<{ value: T; bytes: number }> = [];
  private used = 0;
  dropped = 0;

  constructor(readonly maxBytes: number, readonly maxItems: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
        !Number.isSafeInteger(maxItems) || maxItems < 1) {
      throw new Error("Invalid ring limits");
    }
  }

  push(value: T, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid byte count");
    if (bytes > this.maxBytes) {
      this.dropped++;
      return;
    }
    while (this.items.length >= this.maxItems || this.used + bytes > this.maxBytes) {
      const removed = this.items.shift()!;
      this.used -= removed.bytes;
      this.dropped++;
    }
    this.items.push({ value, bytes });
    this.used += bytes;
  }

  snapshot(): T[] { return this.items.map(item => item.value); }
  get bytes(): number { return this.used; }
  get size(): number { return this.items.length; }
  clear(): void { this.items = []; this.used = 0; this.dropped = 0; }
}
