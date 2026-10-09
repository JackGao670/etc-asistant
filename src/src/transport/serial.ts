import type { SerialPort } from "serialport";
import { loadSerial } from "./serial-probe";
import { EventTransport } from "./network";
import type { TransportConfig, SendTarget } from "../../shared/config";

export class Serial extends EventTransport {
  private port?: SerialPort;
  private opening?: Promise<void>;
  private cancelOpen?: () => void;
  constructor(readonly config: Extract<TransportConfig, { kind: "serial" }>,
    private loader: typeof loadSerial = loadSerial) { super(); }
  open(signal?: AbortSignal): Promise<void> {
    if (this.disposed || signal?.aborted) return Promise.reject(new Error("Serial open cancelled or disposed"));
    if (this.opening) return this.opening;
    if (this.port?.opening) return Promise.reject(new Error("Previous native open is still pending"));
    if (this.status === "connected") return Promise.resolve();
    this.state("opening");
    const operation = (async () => {
      const Port = await this.loader();
      if (this.disposed || signal?.aborted || this.status !== "opening") throw new Error("Serial open cancelled");
      const { path, baudRate, dataBits, stopBits, parity, rtscts } = this.config;
      const port = new Port({ path, baudRate, dataBits, stopBits, parity, rtscts, autoOpen: false });
      this.port = port;
      port.on("data", data => { if (this.port === port) this.emit({ type: "data", data, boundary: "stream" }); });
      port.on("error", e => { if (this.port === port) { this.error(e); this.state("error"); } });
      port.on("close", () => { if (this.port === port) { this.port = undefined; this.state("closed"); } });
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (error?: Error) => {
          if (done) return; done = true; clearTimeout(timer);
          signal?.removeEventListener("abort", abort); this.cancelOpen = undefined;
          if (error) reject(error); else resolve();
        };
        const abort = () => finish(new Error("Serial open cancelled"));
        this.cancelOpen = abort;
        const timer = setTimeout(() => finish(new Error("Serial open timeout")), 10000);
        signal?.addEventListener("abort", abort, { once: true });
        port.open(error => {
          if (done) {
            if (port.isOpen) port.close(e => {
              if (e) this.error(e);
              if (this.port === port) this.port = undefined;
            });
            else if (this.port === port) this.port = undefined;
            return;
          }
          if (error) { finish(error); return; }
          port.set({ dtr: this.config.dtr, ...(rtscts ? {} : { rts: this.config.rts }) }, error => {
            if (done || error) {
              if (port.isOpen) port.close(() => undefined);
              if (error) finish(error);
              return;
            }
            this.state("connected"); finish();
          });
        });
      });
    })().catch(error => { if (this.status !== "closing" && this.status !== "closed") this.state("error"); throw error; });
    this.opening = operation.finally(() => { this.opening = undefined; });
    return this.opening;
  }
  async close() {
    this.state("closing"); this.cancelOpen?.();
    const port = this.port;
    if (port?.isOpen) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Serial close timed out")), 3000);
      port.close(error => { clearTimeout(timer); if (error) reject(error); else resolve(); });
    });
    // Pending native open retains ownership until its callback performs cleanup.
    if (!port?.opening) this.port = undefined;
    this.state("closed");
  }
  async send(data: Buffer, signal?: AbortSignal, target?: SendTarget) {
    if (target) throw new Error("Serial does not accept a send target");
    const port = this.port;
    if (!port?.isOpen || this.status !== "connected" || signal?.aborted) throw new Error("Serial is closed or send cancelled");
    if (!data.length || data.length > 65536) throw new Error("Invalid serial payload");
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) { void this.close().catch(e => this.error(e)); reject(error); } else resolve();
      };
      const abort = () => finish(new Error("Write cancelled; delivery unknown"));
      const timer = setTimeout(() => finish(new Error("Serial write timeout; delivery unknown")), 5000);
      signal?.addEventListener("abort", abort, { once: true });
      port.write(data, error => {
        if (error) finish(error);
        else port.drain(error => finish(error ?? undefined));
      });
    });
    return data.length;
  }
}
