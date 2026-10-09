import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AckWindow } from "../core/ack-window";

export interface BatchProbeResult {
  sentBytes: number;
  acknowledgedBytes: number;
  peakPending: number;
  ackP95Ms: number;
  durationMs: number;
  scope: string;
}

export function runBatchProbe(output: vscode.OutputChannel): Promise<BatchProbeResult> {
  const panel = vscode.window.createWebviewPanel(
    "ect.batchProbe", "ECT Webview Batch Probe", vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: false }
  );
  const nonce = randomBytes(16).toString("hex");
  const token = randomUUID();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
<title>ECT Batch Probe</title></head><body>
<h1>Webview Batch Probe</h1>
<p>Local synthetic data, 1 MiB/s for 10 seconds. No device connection.</p>
<p id="status" role="status">Waiting for Host...</p>
<pre id="sample"></pre>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const token = ${JSON.stringify(token)};
let total = 0;
let lastId = 0;
window.addEventListener("message", event => {
  const m = event.data;
  if (!m || m.token !== token) return;
  if (m.type === "batch") {
    if (!Number.isSafeInteger(m.id) || m.id <= lastId || typeof m.data !== "string"
        || m.data.length > 90000) return;
    const raw = atob(m.data);
    if (raw.length > 65536) return;
    lastId = m.id;
    total += raw.length;
    document.getElementById("status").textContent = "Received bytes: " + total;
    document.getElementById("sample").textContent = Array.from(raw.slice(0, 32),
      c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    vscode.postMessage({type:"ack", token, id:m.id, bytes:raw.length});
  } else if (m.type === "complete" && typeof m.summary === "string") {
    document.getElementById("status").textContent = m.summary;
  }
});
vscode.postMessage({type:"ready", token});
</script></body></html>`;

  return new Promise((resolve, reject) => {
    const window = new AckWindow();
    let timer: NodeJS.Timeout | undefined;
    let done = false;
    let ready = false;
    let startedAt = 0;
    let sent = 0;
    const deadline = setTimeout(() => finish(new Error("Webview ready/probe deadline exceeded")), 25000);
    const subscriptions: vscode.Disposable[] = [];
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      subscriptions.forEach(item => item.dispose());
      if (error) { panel.dispose(); reject(error); return; }
      const samples = [...window.latencies].sort((a, b) => a - b);
      const result: BatchProbeResult = {
        sentBytes: sent, acknowledgedBytes: window.acknowledgedBytes,
        peakPending: window.peakPending,
        ackP95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
        durationMs: Math.round(performance.now() - startedAt),
        scope: "Actual postMessage/base64/DOM/ACK; not React paint or full TCP-to-UI latency"
      };
      output.appendLine(`ECT_WEBVIEW_PROBE_PASS ${JSON.stringify(result)}`);
      void panel.webview.postMessage({ type: "complete", token, summary: JSON.stringify(result) });
      resolve(result);
    };
    const tick = () => {
      if (!panel.visible) { finish(new Error("Probe paused: panel hidden; rerun explicitly")); return; }
      const now = performance.now();
      if (window.expired(now, 5000)) { finish(new Error("Webview ACK timed out")); return; }
      // Pacing stores only counters: a slow consumer cannot grow an unsent queue.
      const expected = Math.floor(Math.min(now - startedAt, 10000) / 1000 * 1048576);
      const bytes = Math.min(65536, expected - sent);
      if (bytes > 0) {
        const id = window.reserve(bytes, now);
        if (id !== undefined) {
          sent += bytes;
          const payload = Buffer.alloc(bytes, id % 256).toString("base64");
          panel.webview.postMessage({ type: "batch", token, id, data: payload }).then(
            accepted => { if (!accepted) finish(new Error("Webview message rejected")); },
            error => finish(new Error(String(error)))
          );
        }
      }
      if (now - startedAt >= 10000 && sent === 10485760 && window.size === 0) finish();
    };
    subscriptions.push(panel.onDidDispose(() => finish(new Error("Probe panel disposed"))));
    subscriptions.push(panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as Record<string, unknown>;
      if (m.token !== token) return;
      if (m.type === "ready" && !ready) {
        ready = true;
        startedAt = performance.now();
        timer = setInterval(tick, 25);
      } else if (m.type === "ack" && ready && Number.isSafeInteger(m.id) &&
                 Number.isSafeInteger(m.bytes)) {
        window.acknowledge(m.id as number, m.bytes as number, performance.now());
      }
    }));
    // Register listeners before loading the script that posts ready.
    panel.webview.html = html;
  });
}
