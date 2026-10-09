import { randomUUID } from "node:crypto";
import { ByteRing } from "../core/ring-buffer";
import { TcpClient } from "../transport/tcp-client";
import { CommunicationError, type Transport } from "../transport/transport";
import type { RecordDto, SessionDto } from "../../shared/messages";
import { transportConfigSchema, type TransportConfig, type SendTarget } from "../../shared/config";
import { TcpServer, Udp } from "../transport/network";
import { Serial } from "../transport/serial";
import { Recorder } from "../logger/logger";
import { loadSerial } from "../transport/serial-probe";

export class Session {
  readonly id: string;
  readonly config: TransportConfig;
  readonly records = new ByteRing<RecordDto>(4 * 1024 * 1024, 10000);
  private generation = 0;
  private sequence = 0;
  private rx = 0;
  private tx = 0;
  private error?: string;
  private controller = new AbortController();
  private sendTail: Promise<unknown> = Promise.resolve();
  private queuedBytes = 0;
  private queuedCount = 0;
  private closing?: Promise<void>;
  private subscription;
  private retryTimer?: NodeJS.Timeout;
  private retryAttempts = 0;
  private reconnect = false;
  private retryGeneration = 0;
  private retryRunning = false;
  private manuallyClosed = false;
  private autoTimer?: NodeJS.Timeout;
  private autoGeneration = 0;
  private autoActive = false;
  private serialIdentity?: { serialNumber: string; vendorId?: string; productId?: string };
  recorder?: Recorder;
  private deleting = false;

  constructor(readonly name: string, private changed: () => void,
              readonly transport: Transport, config?: TransportConfig, id: string = randomUUID()) {
    this.id = id;
    this.config = config ?? { kind: "tcp-client", host: (transport as TcpClient).host, port: (transport as TcpClient).port };
    this.subscription = transport.subscribe(event => {
      if (event.type === "data") { this.rx += event.data.length; this.record("RX", event.data, event.peer, event.boundary); }
      if (event.type === "error") this.error = `${event.error.code}: ${event.error.message}`;
      if (event.type === "status" && (event.status === "closed" || event.status === "error")) {
        this.generation++; this.controller.abort();
        this.stopAuto(); this.scheduleReconnect();
      }
      changed();
    });
  }

  static tcp(host: string, port: number, changed: () => void) {
    return new Session(`TCP ${host}:${port}`, changed, new TcpClient(host, port));
  }
  dto(): SessionDto {
    return { id: this.id, name: this.name, status: this.transport.getStatus(),
      rxBytes: this.rx, txBytes: this.tx, error: this.error, dropped: this.records.dropped };
  }
  details(): SessionDto {
    return { ...this.dto(), kind: this.config.kind, peers: this.transport.peers?.() ?? [],
      auto: this.autoActive, reconnect: this.reconnect, recording: this.recorder?.status.active ?? false };
  }
  async open() {
    if (this.deleting) throw new Error("Session disposed");
    if (this.closing) await this.closing;
    if (this.transport.getStatus() === "opening" || this.transport.getStatus() === "connected") {
      return this.transport.open(this.controller.signal);
    }
    this.controller = new AbortController();
    this.manuallyClosed = false;
    this.error = undefined;
    const generation = this.generation;
    if (this.config.kind === "serial") {
      const path = this.config.path;
      const SerialPort = await loadSerial();
      const port = (await SerialPort.list()).find(p => p.path === path);
      this.serialIdentity = port?.serialNumber ? { serialNumber: port.serialNumber,
        vendorId: port.vendorId, productId: port.productId } : undefined;
    }
    if (generation !== this.generation || this.deleting) throw new Error("Open cancelled");
    await this.transport.open(this.controller.signal);
  }
  private record(direction: "RX" | "TX", data: Buffer, peer?: string, boundary?: "stream" | "datagram",
    result?: "accepted" | "failed" | "unknown", error?: string) {
    // Split only display chunks; do not label stream chunks as protocol packets.
    for (let offset = 0; offset < Math.max(data.length, 1); offset += 65536) {
      const chunk = data.subarray(offset, offset + 65536);
      const row: RecordDto = { sessionId: this.id, sequence: ++this.sequence,
        timestamp: new Date().toISOString(), direction,
        data: chunk.toString("base64"), byteLength: chunk.length, peer, boundary,
        result: direction === "TX" ? result ?? "accepted" : undefined, error };
      this.recorder?.append(row);
      this.records.push(row, chunk.length);
    }
    this.changed();
  }
  send(data: Buffer, target?: SendTarget): Promise<void> {
    if (this.config.kind !== "tcp-server" && target) return Promise.reject(new Error("Invalid target for transport"));
    if (!data.length || data.length > 65536) return Promise.reject(new Error("Invalid payload size"));
    if (this.transport.getStatus() !== "connected") return Promise.reject(new CommunicationError("NOT_CONNECTED", "Connect first"));
    if (++this.queuedCount > 100 || this.queuedBytes + data.length > 1048576) {
      this.queuedCount--;
      return Promise.reject(new CommunicationError("QUEUE_FULL", "Send queue is full"));
    }
    this.queuedBytes += data.length;
    const generation = this.generation;
    const copy = Buffer.from(data);
    const task = this.sendTail.then(async () => {
      if (generation !== this.generation) throw new CommunicationError("CANCELLED", "Queued send cancelled");
      try {
        const bytes = await this.transport.send(copy, this.controller.signal, target);
        this.tx += bytes;
        this.record("TX", copy, target?.kind === "client" ? target.clientId : target?.kind,
          this.config.kind === "udp" ? "datagram" : "stream");
      } catch (error) {
        this.record("TX", copy, target?.kind === "client" ? target.clientId : target?.kind,
          this.config.kind === "udp" ? "datagram" : "stream", "unknown", String(error));
        throw error;
      }
    }).finally(() => { this.queuedBytes -= data.length; this.queuedCount--; });
    this.sendTail = task.catch(() => undefined);
    return task;
  }
  clear() {
    // Keep sequence monotonic, so Webview resynchronization cannot replay old IDs.
    const snapshot = this.records.snapshot();
    this.clearedThrough = snapshot.at(-1)?.sequence ?? this.clearedThrough;
    this.records.clear();
    this.changed();
  }
  clearedThrough = 0;
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.generation++;
    this.manuallyClosed = true; this.stopAuto();
    this.retryGeneration++;
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.controller.abort();
    this.closing = this.transport.close().finally(() => { this.closing = undefined; this.changed(); });
    return this.closing;
  }
  setReconnect(enabled: boolean) {
    if (enabled && !["serial", "tcp-client"].includes(this.config.kind)) throw new Error("Reconnect is only supported by Serial/TCP Client");
    if (enabled && this.config.kind === "serial" && !this.serialIdentity) {
      throw new Error("Serial reconnect requires a connected device with a unique serial number");
    }
    this.reconnect = enabled; this.retryAttempts = 0;
    this.retryGeneration++;
    if (!enabled && this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    this.changed();
  }
  private scheduleReconnect() {
    if (!this.reconnect || this.manuallyClosed || this.retryTimer || this.retryRunning || this.retryAttempts >= 10) return;
    const generation = this.retryGeneration;
    const delay = Math.min(30000, 1000 * 2 ** this.retryAttempts++) * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = undefined;
      this.retryRunning = true;
      try {
        await this.transport.close();
        if (generation !== this.retryGeneration || !this.reconnect || this.manuallyClosed) return;
        if (this.config.kind === "serial") {
          const SerialPort = await loadSerial();
          const identity = this.serialIdentity;
          const matches = (await SerialPort.list()).filter(p => identity && p.serialNumber === identity.serialNumber &&
            p.vendorId === identity.vendorId && p.productId === identity.productId);
          if (matches.length !== 1) throw new Error("Serial identity missing or ambiguous; reconnect not performed");
          this.config.path = matches[0]!.path;
        }
        await this.open(); this.retryAttempts = 0;
      } catch (error) { this.error = String(error); }
      finally { this.retryRunning = false; }
      if (generation === this.retryGeneration && this.transport.getStatus() !== "connected") this.scheduleReconnect();
      this.changed();
    }, delay);
  }
  startAuto(data: Buffer, interval: number, target?: SendTarget) {
    if (interval < 50 || !Number.isSafeInteger(interval) || interval > 3600000) throw new Error("Invalid interval");
    if (this.transport.getStatus() !== "connected") throw new Error("Connect before auto send");
    this.stopAuto(); this.autoActive = true;
    const generation = this.autoGeneration;
    const tick = async () => {
      if (!this.autoActive || generation !== this.autoGeneration) return;
      try { await this.send(data, target); } catch (error) { this.error = String(error); this.stopAuto(); this.changed(); return; }
      if (this.autoActive && generation === this.autoGeneration) this.autoTimer = setTimeout(tick, interval);
    };
    this.autoTimer = setTimeout(tick, interval); this.changed();
  }
  stopAuto() {
    this.autoActive = false; this.autoGeneration++;
    if (this.autoTimer) clearTimeout(this.autoTimer); this.autoTimer = undefined;
  }
  async startRecording(path: string) {
    if (this.recorder?.status.active) throw new Error("Already recording");
    await this.recorder?.stop();
    const recorder = new Recorder(path, error => { if (error) this.error = error; this.changed(); });
    await recorder.start(); this.recorder = recorder; this.changed();
  }
  async stopRecording() { await this.recorder?.stop(); this.changed(); }
  async dispose() { this.deleting = true; await this.close(); await this.stopRecording(); this.subscription.dispose(); await this.transport.dispose(); }
}

export class SessionManager {
  readonly sessions = new Map<string, Session>();
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  private changed = () => this.listeners.forEach(listener => listener());
  createTcp(host: string, port: number) {
    return this.create({ kind: "tcp-client", host, port }, `TCP ${host}:${port}`);
  }
  create(raw: TransportConfig, name: string, id?: string) {
    const config = transportConfigSchema.parse(raw);
    if (this.sessions.size >= 8) throw new CommunicationError("SESSION_LIMIT", "At most 8 sessions");
    if (id && this.sessions.has(id)) throw new Error("Duplicate session ID");
    const transport = config.kind === "tcp-client" ? new TcpClient(config.host, config.port)
      : config.kind === "tcp-server" ? new TcpServer(config)
      : config.kind === "udp" ? new Udp(config) : new Serial(config);
    const session = new Session(name, this.changed, transport, config, id);
    this.sessions.set(session.id, session);
    this.changed();
    return session;
  }
  get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new CommunicationError("SESSION_NOT_FOUND", "Session not found");
    return session;
  }
  async remove(id: string) { const session = this.get(id); await session.dispose(); this.sessions.delete(id); this.changed(); }
  async dispose() { await Promise.all([...this.sessions.values()].map(s => s.dispose())); this.sessions.clear(); this.changed(); this.listeners.clear(); }
}
