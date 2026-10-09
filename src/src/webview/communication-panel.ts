import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { commandSchema, type HostMessage, type RecordDto } from "../../shared/messages";
import { SessionManager } from "../session/session";
import { decodeInput } from "../protocol/codec";
import { AckWindow } from "../core/ack-window";
import { ProfileStore } from "../config/store";
import { loadSerial } from "../transport/serial-probe";
import { decodeInput as decode } from "../protocol/codec";
import { exportLogs } from "../logger/logger";
import type { SendTarget, TransportConfig } from "../../shared/config";
import { language, t } from "../i18n";
import type { LanguageSetting } from "../../shared/i18n";

export function openCommunicationPanel(context: vscode.ExtensionContext, manager: SessionManager, store: ProfileStore) {
  const panel = vscode.window.createWebviewPanel("ect.workbench", t("title"),
    vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")]
    });
  let ready = false;
  let resetting = true;
  const ack = new AckWindow();
  const cursors = new Map<string, number>();
  const send = (message: HostMessage) => panel.webview.postMessage(message);
  const locale = () => {
    panel.title = t("title");
    void send({ type: "locale", language: language(),
      setting: vscode.workspace.getConfiguration("ect").get<LanguageSetting>("language", "auto") });
  };
  const state = () => { if (ready && panel.visible) void send({ type: "state", sessions: [...manager.sessions.values()].map(s => s.details()) }); };
  const profile = () => void send({ type: "profile", profile: store.snapshot() });
  const payload = (data: string, format: "hex" | "ascii", ending: string) => {
    const bytes = decode(data, format);
    const suffix = ending === "lf" ? Buffer.from("\n") : ending === "crlf" ? Buffer.from("\r\n") : Buffer.alloc(0);
    if (bytes.length + suffix.length > 65536) throw new Error(t("payloadLimit"));
    return Buffer.concat([bytes, suffix]);
  };
  const confirm = async (message: string) => {
    const button = t("continue");
    if (await vscode.window.showWarningMessage(message, { modal: true }, button) !== button) throw new Error(t("cancelled"));
    if (!vscode.workspace.isTrusted) throw new Error(t("trust"));
  };
  const checkConfig = async (config: TransportConfig) => {
    if (config.kind === "serial") await confirm(t("serialWarning", config.path));
    if ((config.kind === "udp" || config.kind === "tcp-server") && config.host !== "127.0.0.1") {
      await confirm(t("bindWarning", config.host));
    }
    if (config.kind === "udp" && config.broadcast) await confirm(t("udpWarning"));
  };
  const checkTarget = async (target?: SendTarget) => {
    if (target?.kind === "broadcast") await confirm(t("targetWarning"));
  };
  const subscriptions: vscode.Disposable[] = [];
  subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("ect.language")) locale(); }));
  let lastState = 0;
  let rotation = 0;
  const tick = () => {
    if (!ready || !panel.visible) return;
    if (ack.expired(performance.now(), 5000)) {
      ready = false;
      void send({ type: "response", requestId: "resync", ok: true });
      return;
    }
    if (Date.now() - lastState > 250) { state(); lastState = Date.now(); }
    if (ack.size >= 4) return;
    const records: RecordDto[] = [];
    let bytes = 0;
    const sessions = [...manager.sessions.values()];
    if (sessions.length) rotation = (rotation + 1) % sessions.length;
    for (const session of [...sessions.slice(rotation), ...sessions.slice(0, rotation)]) {
      const history = session.records.snapshot();
      let cursor = cursors.get(session.id) ?? session.clearedThrough;
      const first = history[0];
      if (first && cursor < first.sequence - 1) cursor = first.sequence - 1;
      for (const row of history) {
        if (row.sequence <= cursor) continue;
        if (row.byteLength === 0) { cursor = row.sequence; continue; }
        if (bytes + row.byteLength > 65536 || records.length >= 256) break;
        records.push(row); bytes += row.byteLength; cursor = row.sequence;
      }
      cursors.set(session.id, cursor);
      if (bytes >= 65536 || records.length >= 256) break;
    }
    if (!bytes) return;
    const batchId = ack.reserve(bytes, performance.now())!;
    const reset = resetting;
    resetting = false;
    send({ type: "batch", batchId, bytes, records, reset }).then(accepted => {
      if (!accepted) ready = false;
    }, () => { ready = false; });
  };
  const timer = setInterval(tick, 25);
  subscriptions.push(panel.onDidChangeViewState(() => {
    if (!panel.visible) ready = false;
    else void send({ type: "response", requestId: "resync", ok: true });
  }));
  subscriptions.push(panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) {
      if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).requestId === "string") {
        const requestId = (raw as { requestId: string }).requestId.slice(0, 100);
        void send({ type: "response", requestId, ok: false, error: t("invalidMessage") });
      }
      return;
    }
    const m = parsed.data;
    try {
      if (m.type === "ready") {
        ready = true; resetting = true; ack.reset(); cursors.clear(); locale(); state(); profile(); tick(); return;
      }
      if (m.type === "ack") { ack.acknowledge(m.batchId, m.bytes, performance.now()); return; }
      if (m.type === "language") {
        const config = vscode.workspace.getConfiguration("ect");
        const target = config.inspect("language")?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update("language", m.language, target);
        locale(); return;
      }
      if (!vscode.workspace.isTrusted) throw new Error(t("trust"));
      if (m.type === "connect") {
        const session = manager.createTcp(m.host, m.port);
        try { await session.open(); } catch (error) { await manager.remove(session.id); throw error; }
      } else if (m.type === "create") {
        manager.create(m.config, m.name); profile();
      } else if (m.type === "open") {
        const session = manager.get(m.sessionId);
        await checkConfig(session.config);
        await session.open();
      } else if (m.type === "close") await manager.get(m.sessionId).close();
      else if (m.type === "disconnect") { await manager.remove(m.sessionId); profile(); }
      else if (m.type === "ports") {
        const Serial = await loadSerial();
        void send({ type: "ports", ports: (await Serial.list()).map(p => p.path) });
      } else if (m.type === "reconnect") {
        if (m.enabled && manager.get(m.sessionId).config.kind === "serial") {
          await confirm(t("reconnectWarning"));
        }
        manager.get(m.sessionId).setReconnect(m.enabled);
      } else if (m.type === "auto") {
        const session = manager.get(m.sessionId);
        if (!m.enabled) session.stopAuto();
        else {
          await checkTarget(m.target);
          session.startAuto(payload(m.data, m.format, m.lineEnding), m.interval, m.target);
        }
      } else if (m.type === "quick-save") {
        payload(m.command.data, m.command.format, m.command.lineEnding);
        const commands = store.profile.commands.filter(c => c.id !== m.command.id);
        if (commands.length >= 100) throw new Error(t("quickLimit"));
        store.profile.commands = [...commands, m.command]; profile();
      } else if (m.type === "quick-delete") {
        store.profile.commands = store.profile.commands.filter(c => c.id !== m.commandId); profile();
      } else if (m.type === "quick-send") {
        const command = store.profile.commands.find(c => c.id === m.commandId);
        if (!command) throw new Error(t("commandMissing"));
        if (command.dangerous) await confirm(t("dangerousWarning", command.name));
        await checkTarget(m.target);
        await manager.get(m.sessionId).send(payload(command.data, command.format, command.lineEnding), m.target);
      } else if (m.type === "config-save") { await store.save(); profile(); }
      else if (m.type === "config-load") {
        await store.load(); profile();
        void send({ type: "response", requestId: "resync", ok: true });
      } else if (m.type === "record") {
        const session = manager.get(m.sessionId);
        if (!m.enabled) await session.stopRecording();
        else {
          const uri = await vscode.window.showSaveDialog({ title: t("recordDialog"), filters: { JSONL: ["jsonl"] } });
          if (!uri) throw new Error(t("cancelled"));
          if (uri.scheme !== "file") throw new Error(t("localRecord"));
          if (!vscode.workspace.isTrusted) throw new Error(t("trust"));
          await session.startRecording(uri.fsPath);
        }
      } else if (m.type === "export") {
        const session = manager.get(m.sessionId);
        if (!session.recorder) throw new Error(t("recordFirst"));
        await session.stopRecording();
        if (session.recorder.status.error) throw new Error(session.recorder.status.error);
        const uri = await vscode.window.showSaveDialog({ title: t("exportDialog"), filters: { [m.format]: [m.format] } });
        if (!uri) throw new Error(t("cancelled"));
        if (uri.scheme !== "file") throw new Error(t("localExport"));
        if (!vscode.workspace.isTrusted) throw new Error(t("trust"));
        await exportLogs(session.recorder.status.files, uri.fsPath, m.format);
      }
      else if (m.type === "clear") {
        manager.get(m.sessionId).clear(); cursors.clear(); resetting = true; ack.reset();
        void send({ type: "response", requestId: "resync", ok: true });
      } else if (m.type === "send") {
        await checkTarget(m.target);
        await manager.get(m.sessionId).send(payload(m.data, m.format, m.lineEnding), m.target);
      }
      state();
      void send({ type: "response", requestId: m.requestId, ok: true });
    } catch (error) {
      void send({ type: "response", requestId: m.requestId, ok: false,
        error: error instanceof Error ? error.message : String(error) });
    }
  }));
  panel.onDidDispose(() => { clearInterval(timer); subscriptions.forEach(item => item.dispose()); });
  const resource = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", name));
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = `<!doctype html><html lang="${language()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline';">
<link rel="stylesheet" href="${resource("app.css")}"><title>ECT Communication</title></head>
<body><div id="root"></div><script type="module" nonce="${nonce}" src="${resource("app.js")}"></script></body></html>`;
  return panel;
}
