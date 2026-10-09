import { open, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { z } from "zod";
import type { RecordDto } from "../../shared/messages";

export const recordSchema = z.object({
  schemaVersion: z.literal(1), sessionId: z.string(), sequence: z.number().int().positive(),
  timestamp: z.string(), direction: z.enum(["RX", "TX"]), byteLength: z.number().int().nonnegative(),
  data: z.string(), peer: z.string().optional(), boundary: z.enum(["stream", "datagram"]).optional(),
  result: z.enum(["accepted", "failed", "unknown"]).optional(), error: z.string().optional()
});
export class Recorder {
  private static globalQueued = 0;
  private file?: FileHandle;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private size = 0;
  private total = 0;
  private part = 0;
  private accepting = false;
  private failure?: string;
  private files: string[] = [];
  constructor(readonly path: string, private notify: (error?: string) => void,
    readonly queueLimit = 16 * 1024 * 1024, readonly rotateBytes = 100 * 1024 * 1024,
    readonly totalLimit = 1024 * 1024 * 1024) {}
  async start() {
    await mkdir(dirname(this.path), { recursive: true });
    this.file = await open(this.path, "wx"); this.files.push(this.path); this.accepting = true;
  }
  get status() { return { active: this.accepting, error: this.failure, files: [...this.files] }; }
  append(row: RecordDto) {
    if (!this.accepting) return;
    const line = JSON.stringify({ schemaVersion: 1, ...row }) + "\n";
    const bytes = Buffer.byteLength(line);
    if (this.queued + bytes > this.queueLimit || Recorder.globalQueued + bytes > 16 * 1024 * 1024 ||
        this.total + bytes > this.totalLimit) {
      this.fail("Recording budget exceeded; recording is incomplete"); return;
    }
    this.queued += bytes; Recorder.globalQueued += bytes; this.total += bytes;
    this.tail = this.tail.then(async () => {
      if (this.failure || !this.file) return;
      if (this.size > 0 && this.size + bytes > this.rotateBytes) {
        await this.file.sync(); await this.file.close();
        const path = `${this.path}.${++this.part}.jsonl`;
        this.file = await open(path, "wx"); this.files.push(path); this.size = 0;
      }
      await this.file.writeFile(line); this.size += bytes;
    }).catch(error => this.fail(`Recording write failed: ${String(error)}; incomplete`))
      .finally(() => { this.queued -= bytes; Recorder.globalQueued -= bytes; });
  }
  private fail(message: string) {
    if (this.failure) return;
    this.failure = message; this.accepting = false; this.notify(message);
  }
  async stop() {
    this.accepting = false; await this.tail;
    if (this.file) {
      try {
        if (this.failure) await this.file.writeFile(JSON.stringify({ type: "incomplete", error: this.failure }) + "\n");
        await this.file.sync();
      } catch (error) { this.fail(`Recording finalization failed: ${String(error)}`); }
      finally { await this.file.close(); this.file = undefined; }
    }
    this.notify(this.failure);
  }
}

export function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportLogs(sources: string[], destination: string, format: "txt" | "csv") {
  const output = createWriteStream(destination, { flags: "wx" });
  let outputError: Error | undefined;
  output.on("error", error => { outputError = error; });
  await once(output, "open");
  const write = async (line: string) => {
    if (outputError) throw outputError;
    if (!output.write(line)) await once(output, "drain");
  };
  let count = 0;
  try {
    if (format === "csv") await write("timestamp,session,direction,peer,boundary,result,bytes,hex,error\n");
    for (const source of sources) {
      const input = createReadStream(source);
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          let parsed: unknown;
          try { parsed = JSON.parse(line); } catch { throw new Error(`Invalid/truncated JSONL in ${source}`); }
          if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "incomplete") {
            throw new Error("Source recording is marked incomplete");
          }
          const row = recordSchema.parse(parsed);
          const bytes = Buffer.from(row.data, "base64");
          if (bytes.length !== row.byteLength) throw new Error("Record byte length mismatch");
          const hex = bytes.toString("hex").match(/.{2}/g)?.join(" ").toUpperCase() ?? "";
          if (format === "csv") await write([row.timestamp, row.sessionId, row.direction, row.peer ?? "",
            row.boundary ?? "", row.result ?? "", String(row.byteLength), hex, row.error ?? ""].map(csvCell).join(",") + "\n");
          else await write(`${row.timestamp} ${row.sessionId} ${row.direction} ${row.peer ?? ""} ${row.result ?? ""} ${hex} ${row.error ?? ""}\n`);
          count++;
        }
      } finally { lines.close(); input.destroy(); }
    }
    const finished = once(output, "finish"); output.end(); await finished;
    return count;
  } finally { if (!output.closed) output.destroy(); }
}
