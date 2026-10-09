import { Socket } from "node:net";
import { CommunicationError, type Transport, type TransportEvent } from "./transport";
import type { Status } from "../../shared/messages";
import type { SendTarget } from "../../shared/config";

export class TcpClient implements Transport {
  private socket?: Socket;
  private status: Status = "closed";
  private listeners = new Set<(event: TransportEvent) => void>();
  private opening?: Promise<void>;
  private cancelOpen?: () => void;
  private disposed = false;

  constructor(readonly host: string, readonly port: number, readonly timeout = 10000) {}
  subscribe(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  private emit(event: TransportEvent) { this.listeners.forEach(listener => listener(event)); }
  private state(status: Status) { this.status = status; this.emit({ type: "status", status }); }
  getStatus() { return this.status; }

  open(signal?: AbortSignal): Promise<void> {
    if (this.disposed) return Promise.reject(new CommunicationError("DISPOSED", "Transport disposed"));
    if (this.opening) return this.opening;
    if (this.status === "connected") return Promise.resolve();
    if (!this.host.trim() || !Number.isSafeInteger(this.port) || this.port < 1 || this.port > 65535) {
      return Promise.reject(new CommunicationError("INVALID_CONFIG", "Invalid TCP address or port"));
    }
    if (signal?.aborted) return Promise.reject(new CommunicationError("CANCELLED", "Open cancelled"));
    const socket = new Socket();
    this.socket = socket;
    this.state("opening");
    socket.on("data", data => { if (this.socket === socket) this.emit({ type: "data", data }); });
    socket.on("error", error => {
      if (this.socket !== socket) return;
      this.emit({ type: "error", error: new CommunicationError("SOCKET_ERROR", error.message) });
      if (this.status !== "closing") this.state("error");
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.status !== "error") this.state("closed");
    });
    const operation = new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        socket.off("connect", connected);
        socket.off("error", failed);
        socket.off("close", closed);
        this.cancelOpen = undefined;
        if (error) { socket.destroy(); reject(error); } else resolve();
      };
      const abort = () => finish(new CommunicationError("CANCELLED", "Open cancelled"));
      const connected = () => { this.state("connected"); finish(); };
      const failed = (error: Error) => finish(new CommunicationError("CONNECT_FAILED", error.message));
      const closed = () => finish(new CommunicationError("CANCELLED", "Connection closed during open"));
      const timer = setTimeout(() => {
        this.state("error");
        finish(new CommunicationError("CONNECT_TIMEOUT", "Connection timed out"));
      }, this.timeout);
      this.cancelOpen = abort;
      socket.once("connect", connected);
      socket.once("error", failed);
      socket.once("close", closed);
      signal?.addEventListener("abort", abort, { once: true });
      try { socket.connect(this.port, this.host); } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.opening = operation.finally(() => { this.opening = undefined; });
    return this.opening;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket) { this.state("closed"); return; }
    this.state("closing");
    this.cancelOpen?.();
    await new Promise<void>(resolve => {
      if (socket.closed) { resolve(); return; }
      const timer = setTimeout(() => { socket.destroy(); resolve(); }, 3000);
      socket.once("close", () => { clearTimeout(timer); resolve(); });
      socket.destroy();
    });
    if (this.socket === socket) this.socket = undefined;
    this.state("closed");
  }

  async send(data: Buffer, signal?: AbortSignal, target?: SendTarget): Promise<number> {
    if (target) throw new CommunicationError("INVALID_TARGET", "TCP Client does not accept a target");
    const socket = this.socket;
    if (!socket || this.status !== "connected") throw new CommunicationError("NOT_CONNECTED", "Connect first");
    if (!data.length || data.length > 65536) throw new CommunicationError("PAYLOAD_LIMIT", "Invalid payload size");
    if (signal?.aborted) throw new CommunicationError("CANCELLED", "Send cancelled");
    return new Promise<number>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.off("close", closed);
        signal?.removeEventListener("abort", abort);
        if (error) { socket.destroy(); reject(error); } else resolve(data.length);
      };
      const closed = () => finish(new CommunicationError("DELIVERY_UNKNOWN", "Connection closed during write"));
      const abort = () => finish(new CommunicationError("DELIVERY_UNKNOWN", "Write cancelled; delivery unknown"));
      const timer = setTimeout(() => finish(new CommunicationError("WRITE_TIMEOUT", "Write timeout; delivery unknown")), 5000);
      socket.once("close", closed);
      signal?.addEventListener("abort", abort, { once: true });
      socket.write(data, error => finish(error ? new CommunicationError("WRITE_FAILED", error.message) : undefined));
    });
  }
  async dispose() { this.disposed = true; await this.close(); this.listeners.clear(); }
}
