export class AckWindow {
  private pending = new Map<number, { bytes: number; sentAt: number }>();
  private nextId = 1;
  readonly latencies: number[] = [];
  acknowledgedBytes = 0;
  peakPending = 0;

  constructor(readonly limit = 4, readonly maxBytes = 65536) {
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid ACK limits");
  }

  reserve(bytes: number, now: number): number | undefined {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBytes) {
      throw new Error("Invalid batch size");
    }
    if (!Number.isFinite(now)) throw new Error("Invalid batch timestamp");
    if (this.pending.size >= this.limit) return undefined;
    const id = this.nextId++;
    this.pending.set(id, { bytes, sentAt: now });
    this.peakPending = Math.max(this.peakPending, this.pending.size);
    return id;
  }

  acknowledge(id: number, bytes: number, now: number): boolean {
    const batch = this.pending.get(id);
    if (!batch || batch.bytes !== bytes) return false;
    this.pending.delete(id);
    this.acknowledgedBytes += bytes;
    // Diagnostic sample storage is bounded independently from the message window.
    if (this.latencies.length < 10000) this.latencies.push(now - batch.sentAt);
    return true;
  }

  expired(now: number, timeout: number): boolean {
    return [...this.pending.values()].some(batch => now - batch.sentAt >= timeout);
  }

  get size(): number { return this.pending.size; }
  reset(): void { this.pending.clear(); }
}
