import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { randomUUID } from "node:crypto";
import { CommunicationError, type Transport, type TransportEvent } from "./transport";
import type { Status } from "../../shared/messages";
import type { TransportConfig, SendTarget } from "../../shared/config";

export abstract class EventTransport implements Transport {
  protected status: Status = "closed";
  protected disposed = false;
  private listeners = new Set<(e: TransportEvent) => void>();
  subscribe(listener: (e: TransportEvent) => void) {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }
  protected emit(e: TransportEvent) { this.listeners.forEach(l => l(e)); }
  protected state(status: Status) { this.status = status; this.emit({ type: "status", status }); }
  protected error(error: Error) {
    this.emit({ type: "error", error: new CommunicationError("IO_ERROR", error.message) });
  }
  getStatus() { return this.status; }
  abstract open(signal?: AbortSignal): Promise<void>;
  abstract close(): Promise<void>;
  abstract send(data: Buffer, signal?: AbortSignal, target?: SendTarget): Promise<number>;
  async dispose() { this.disposed = true; await this.close(); this.listeners.clear(); }
}

export class TcpServer extends EventTransport {
  private server?: Server;
  private clients = new Map<string, Socket>();
  private opening?: Promise<void>;
  constructor(readonly config: Extract<TransportConfig, { kind: "tcp-server" }>) { super(); }
  peers() { return [...this.clients].map(([id, s]) => ({ id, address: `${s.remoteAddress}:${s.remotePort}` })); }
  open(signal?: AbortSignal): Promise<void> {
    if (this.disposed || signal?.aborted) return Promise.reject(new Error("Open cancelled or disposed"));
    if (this.opening) return this.opening;
    if (this.status === "connected") return Promise.resolve();
    const server = createServer(socket => {
      if (this.clients.size >= 16 || this.status !== "connected") { socket.destroy(); return; }
      const id = randomUUID(); this.clients.set(id, socket); this.emit({ type: "peers" });
      socket.on("data", data => this.emit({ type: "data", data, peer: id, boundary: "stream" }));
      socket.on("error", e => this.error(e));
      socket.on("close", () => { this.clients.delete(id); this.emit({ type: "peers" }); });
    });
    this.server = server; this.state("opening");
    server.on("error", e => { this.error(e); if (this.status !== "closing") this.state("error"); });
    const operation = new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        server.off("error", failed); server.off("close", closed);
        if (error) { try { server.close(); } catch {} reject(error); } else resolve();
      };
      const abort = () => finish(new Error("Listen cancelled"));
      const failed = (e: Error) => finish(e);
      const closed = () => finish(new Error("Listener closed during open"));
      const timer = setTimeout(() => finish(new Error("Listen timed out")), 10000);
      signal?.addEventListener("abort", abort, { once: true });
      server.once("error", failed); server.once("close", closed);
      server.listen(this.config.port, this.config.host, () => {
        if (done) { server.close(); return; }
        this.state("connected"); finish();
      });
    });
    this.opening = operation.finally(() => { this.opening = undefined; });
    return this.opening;
  }
  async close() {
    const server = this.server;
    this.state("closing");
    this.clients.forEach(s => s.destroy()); this.clients.clear();
    if (server) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 3000);
      try { server.close(() => { clearTimeout(timer); resolve(); }); } catch { clearTimeout(timer); resolve(); }
    });
    this.server = undefined; this.state("closed");
  }
  async send(data: Buffer, signal?: AbortSignal, target?: SendTarget) {
    if (this.status !== "connected" || !target) throw new Error("Select a connected server client");
    if (!data.length || data.length > 65536) throw new Error("Invalid payload size");
    const clients = target.kind === "broadcast" ? [...this.clients] :
      [...this.clients].filter(([id]) => id === target.clientId);
    if (!clients.length) throw new Error("No target clients");
    const results = await Promise.all(clients.map(([id, socket]) => new Promise<{ id: string; error?: string }>(resolve => {
      let done = false;
      const finish = (error?: string) => {
        if (done) return; done = true; clearTimeout(timer);
        socket.off("close", closed); signal?.removeEventListener("abort", abort);
        if (error) socket.destroy();
        resolve({ id, error });
      };
      const closed = () => finish("Delivery unknown: connection closed");
      const abort = () => finish("Delivery unknown: cancelled");
      const timer = setTimeout(() => finish("Delivery unknown: write timeout"), 5000);
      socket.once("close", closed); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      socket.write(data, e => finish(e?.message));
    })));
    if (results.some(r => r.error)) throw new CommunicationError("PARTIAL_SEND", JSON.stringify(results));
    return data.length * clients.length;
  }
}

export class Udp extends EventTransport {
  private socket?: DatagramSocket;
  private opening?: Promise<void>;
  constructor(readonly config: Extract<TransportConfig, { kind: "udp" }>) { super(); }
  open(signal?: AbortSignal): Promise<void> {
    if (this.disposed || signal?.aborted) return Promise.reject(new Error("Open cancelled or disposed"));
    if (this.opening) return this.opening;
    if (this.status === "connected") return Promise.resolve();
    const socket = createSocket("udp4"); this.socket = socket; this.state("opening");
    socket.on("message", (data, remote) => this.emit({ type: "data", data,
      peer: `${remote.address}:${remote.port}`, boundary: "datagram" }));
    socket.on("error", e => { this.error(e); this.state("error"); });
    const operation = new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer);
        signal?.removeEventListener("abort", abort); socket.off("error", failed); socket.off("close", closed);
        if (error) { try { socket.close(); } catch {} reject(error); } else resolve();
      };
      const abort = () => finish(new Error("UDP bind cancelled"));
      const failed = (e: Error) => finish(e);
      const closed = () => finish(new Error("UDP closed during open"));
      const timer = setTimeout(() => finish(new Error("UDP bind timed out")), 10000);
      signal?.addEventListener("abort", abort, { once: true });
      socket.once("error", failed); socket.once("close", closed);
      socket.bind(this.config.port, this.config.host, () => {
        if (done) { try { socket.close(); } catch {} return; }
        try { socket.setBroadcast(this.config.broadcast); this.state("connected"); finish(); } catch (e) { finish(e as Error); }
      });
    });
    this.opening = operation.finally(() => { this.opening = undefined; }); return this.opening;
  }
  async close() {
    const socket = this.socket; this.socket = undefined; this.state("closing");
    if (socket) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 3000);
      try { socket.close(() => { clearTimeout(timer); resolve(); }); } catch { clearTimeout(timer); resolve(); }
    });
    this.state("closed");
  }
  async send(data: Buffer, signal?: AbortSignal, target?: SendTarget) {
    if (target) throw new Error("UDP uses the configured remote address");
    const socket = this.socket;
    if (!socket || this.status !== "connected") throw new Error("UDP is closed");
    if (signal?.aborted) throw new Error("Send cancelled");
    if (!data.length || data.length > this.config.maxDatagram) throw new Error("UDP datagram exceeds configured limit");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.close(); reject(new Error("UDP send timed out; delivery unknown"));
      }, 5000);
      socket.send(data, this.config.remotePort, this.config.remoteHost, e => {
        clearTimeout(timer); if (e) reject(e); else resolve();
      });
    });
    return data.length;
  }
}
