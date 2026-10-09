import { createServer, connect } from "node:net";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { ByteRing } from "./ring-buffer";

export async function runPipelineProbe(file: string, durationMs = 10000,
                                       bytesPerSecond = 1024 * 1024) {
  if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 600000 ||
      !Number.isSafeInteger(bytesPerSecond) || bytesPerSecond < 1 || bytesPerSecond > 10 * 1024 * 1024) {
    throw new Error("Invalid probe duration or rate");
  }
  const ring = new ByteRing<Buffer>(4 * 1024 * 1024, 10000);
  const sentHash = createHash("sha256");
  const recordedHash = createHash("sha256");
  const output = createWriteStream(file, { flags: "wx", highWaterMark: 64 * 1024 });
  let outputError: Error | undefined;
  output.on("error", error => { outputError = error; });
  await once(output, "open");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local TCP address");
  const peerPromise = once(server, "connection");
  const receiver = connect(address.port, "127.0.0.1");
  receiver.on("error", () => undefined);
  const [sender] = await peerPromise as [import("node:net").Socket];
  sender.on("error", () => undefined);
  const startMemory = process.memoryUsage().rss;
  let peakMemory = startMemory;
  let sent = 0;
  let received = 0;
  let sequence = 0;
  let batches = 0;
  let batchBytes = 0;
  let pendingBytes = 0;
  let maxPendingBytes = 0;
  let failure: Error | undefined;
  const start = performance.now();
  const memoryTimer = setInterval(() => {
    peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
  }, 50);
  receiver.on("data", (data: Buffer) => {
    received += data.length;
    recordedHash.update(data);
    ring.push(Buffer.from(data), data.length);
    batchBytes += data.length;
    pendingBytes += data.length;
    maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
    if (pendingBytes > 16 * 1024 * 1024) {
      failure = new Error("Recording hard limit exceeded");
      receiver.destroy(failure);
      return;
    }
    const record = JSON.stringify({
      schemaVersion: 1, sessionId: "pipeline-probe", sequence: ++sequence,
      timestamp: new Date().toISOString(), direction: "RX", data: data.toString("base64"),
      byteLength: data.length
    }) + "\n";
    if (!output.write(record, error => {
      pendingBytes -= data.length;
      if (error) { failure = error; receiver.destroy(error); }
    })) {
      receiver.pause();
      output.once("drain", () => receiver.resume());
    }
  });
  // Counts synthetic batch flushes, not actual Webview ACK or rendering latency.
  const batchTimer = setInterval(() => {
    while (batchBytes > 0) {
      batchBytes -= Math.min(batchBytes, 64 * 1024);
      batches++;
    }
  }, 25);
  const receiverClosed = once(receiver, "close");
  const chunk = Buffer.alloc(16 * 1024);
  try {
    while (performance.now() - start < durationMs) {
      if (failure || outputError) throw failure ?? outputError;
      chunk.writeUInt32LE(sent / chunk.length);
      const copy = Buffer.from(chunk);
      sentHash.update(copy);
      sent += copy.length;
      if (!sender.write(copy)) await once(sender, "drain");
      const delay = sent / bytesPerSecond * 1000 - (performance.now() - start);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 1000)));
    }
    sender.end();
    await Promise.race([
      receiverClosed,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("TCP receive drain timed out")), 10000);
        timer.unref();
        receiverClosed.finally(() => clearTimeout(timer)).catch(() => undefined);
      })
    ]);
    const finished = once(output, "finish");
    output.end();
    await finished;
    if (failure || outputError) throw failure ?? outputError;
    const expectedHash = sentHash.digest("hex");
    const actualHash = recordedHash.digest("hex");
    if (sent !== received || expectedHash !== actualHash) throw new Error("TCP data mismatch");
    return {
      durationMs: Math.round(performance.now() - start),
      bytesPerSecond, sent, received, sha256: actualHash, records: sequence,
      retainedBytes: ring.bytes, retainedRecords: ring.size, previewDropped: ring.dropped,
      syntheticBatches: batches, maxPendingBytes,
      rssBaseline: startMemory, rssPeak: peakMemory, rssDelta: peakMemory - startMemory,
      scope: "Node TCP/JSONL only; no Webview rendering or Extension Host certification"
    };
  } finally {
    clearInterval(memoryTimer);
    clearInterval(batchTimer);
    sender.destroy();
    receiver.destroy();
    server.close();
    if (!output.closed) output.destroy();
  }
}
