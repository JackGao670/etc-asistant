import type { SerialPort } from "serialport";

export async function loadSerial() {
  // Native dependency failure is isolated from extension activation and TCP.
  const { SerialPort } = await import("serialport");
  return SerialPort;
}

export class SerialProbe {
  private port?: SerialPort;
  private opening = false;
  private cancelled = false;

  async open(path: string, baudRate: number, onData: (data: Buffer) => void,
             onError: (error: Error) => void): Promise<void> {
    if (!path.trim() || !Number.isSafeInteger(baudRate) || baudRate < 1 || baudRate > 3000000) {
      throw new Error("Invalid serial path or baud rate");
    }
    if (this.port || this.opening) throw new Error("Probe is already open");
    this.opening = true;
    this.cancelled = false;
    let Serial: Awaited<ReturnType<typeof loadSerial>>;
    try {
      Serial = await loadSerial();
      if (this.cancelled) throw new Error("Serial open cancelled");
    } catch (error) {
      this.opening = false;
      throw error;
    }
    const port = new Serial({ path, baudRate, autoOpen: false });
    this.port = port;
    port.on("data", onData);
    port.on("error", onError);
    try {
      await new Promise<void>((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => {
          expired = true;
          // Keep ownership until a late native open callback closes the handle.
          reject(new Error("Serial open timed out; late completion will be closed"));
        }, 10000);
        port.open(error => {
          clearTimeout(timer);
          this.opening = false;
          if (expired || this.cancelled) {
            if (port.isOpen) port.close(closeError => {
              this.port = undefined;
              if (closeError) onError(closeError);
            });
            else this.port = undefined;
            reject(new Error("Serial open cancelled"));
            return;
          }
          if (error) reject(error); else resolve();
        });
      });
    } catch (error) {
      if (!port.opening && !port.isOpen) this.port = undefined;
      throw error;
    }
  }

  async send(data: Buffer): Promise<void> {
    const port = this.port;
    if (!port?.isOpen || this.cancelled) throw new Error("Serial probe is closed");
    if (!data.length || data.length > 65536) throw new Error("Invalid serial payload size");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.close().catch(() => undefined);
        reject(new Error("Write timed out; delivery is unknown"));
      }, 5000);
      port.write(data, error => {
        if (error) { clearTimeout(timer); reject(error); return; }
        port.drain(error => {
          clearTimeout(timer);
          if (error) reject(error); else resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    this.cancelled = true;
    const port = this.port;
    if (!port) return;
    // Native open cannot be forcibly aborted; its callback owns late cleanup.
    if (this.opening || port.opening) return;
    if (!port.isOpen) { this.port = undefined; return; }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Serial close timed out")), 3000);
      port.close(error => {
        clearTimeout(timer);
        this.port = undefined;
        if (error) reject(error); else resolve();
      });
    });
  }
}
