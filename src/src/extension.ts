import * as vscode from "vscode";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSerial, SerialProbe } from "./transport/serial-probe";
import { decodeInput, formatHex } from "./protocol/codec";
import { runPipelineProbe } from "./core/pipeline-probe";
import { runBatchProbe } from "./webview/batch-probe";
import { SessionManager } from "./session/session";
import { openCommunicationPanel } from "./webview/communication-panel";
import { ProfileStore } from "./config/store";
import { t } from "./i18n";

let activeProbe: SerialProbe | undefined;
let manager: SessionManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("ECT Phase 0");
  context.subscriptions.push(output);
  manager = new SessionManager();
  const sessions = manager;
  const store = new ProfileStore(context, sessions);
  let panel: vscode.WebviewPanel | undefined;
  const treeChanged = new vscode.EventEmitter<void>();
  let refreshTimer: NodeJS.Timeout | undefined;
  const subscription = sessions.subscribe(() => {
    if (!refreshTimer) refreshTimer = setTimeout(() => {
      refreshTimer = undefined; treeChanged.fire();
    }, 200);
  });
  context.subscriptions.push(treeChanged, subscription,
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("ect.language")) treeChanged.fire(); }),
    { dispose: () => { if (refreshTimer) clearTimeout(refreshTimer); panel?.dispose(); } },
    vscode.window.registerTreeDataProvider("ect.connections", {
      onDidChangeTreeData: treeChanged.event,
      getChildren: () => [...sessions.sessions.values()].map(s => s.dto()),
      getTreeItem: item => {
        const node = new vscode.TreeItem(item.name);
        node.description = t(item.status);
        node.tooltip = `${item.name}\nRX ${item.rxBytes} / TX ${item.txBytes}\n${t("local")}`;
        node.command = { command: "ect.open", title: t("open") };
        return node;
      }
    }));
  const requireTrust = () => {
    if (!vscode.workspace.isTrusted) throw new Error(t("trust"));
  };
  const command = (id: string, action: () => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { await action(); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`ERROR: ${message}`);
        void vscode.window.showErrorMessage(`ECT: ${message}`);
      }
    }));
  };
  command("ect.diagnostics", async () => {
    output.show(true);
    output.appendLine(JSON.stringify({
      extension: context.extension.id, vscode: vscode.version, node: process.version,
      napi: process.versions.napi, platform: process.platform, arch: process.arch,
      communicationHost: hostname(), remoteWorkspace: vscode.env.remoteName ?? null,
      trusted: vscode.workspace.isTrusted, extensionKind: context.extension.extensionKind,
      installedAt: context.extensionUri.toString()
    }, null, 2));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, ".vscode", "ect.json");
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        output.appendLine(`Workspace URI accessible: ${uri.toString()} (${stat.size} bytes)`);
      } catch (error) {
        output.appendLine(`Workspace URI not read: ${uri.toString()} (${String(error)})`);
      }
    }
  });
  command("ect.open", async () => {
    if (panel) { panel.reveal(); return; }
    panel = openCommunicationPanel(context, sessions, store);
    panel.onDidDispose(() => { panel = undefined; });
  });
  command("ect.disconnectAll", async () => {
    await Promise.all([...sessions.sessions.keys()].map(id => sessions.remove(id)));
  });
  command("ect.stopProbe", async () => {
    await activeProbe?.close();
    activeProbe = undefined;
    output.appendLine(t("probeStopped"));
  });
  command("ect.serialProbe", async () => {
    requireTrust();
    if (activeProbe) throw new Error("Stop the existing serial probe first");
    const Serial = await loadSerial();
    const ports = await Serial.list();
    const chosen = await vscode.window.showQuickPick([
      ...ports.map(port => ({ label: port.path, description: port.manufacturer })),
      { label: t("manualPath"), description: "", manual: true }
    ], { title: t("portDialog") });
    if (!chosen) return;
    const path = "manual" in chosen
      ? await vscode.window.showInputBox({ prompt: t("pathPrompt") })
      : chosen.label;
    if (!path) return;
    const baud = await vscode.window.showInputBox({
      value: "115200", prompt: t("baud"),
      validateInput: value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 3000000
        ? undefined : t("baudValidation")
    });
    if (!baud) return;
    const confirm = await vscode.window.showWarningMessage(
      t("probeWarning", path, baud),
      { modal: true }, t("open"));
    if (confirm !== t("open")) return;
    requireTrust();
    const probe = new SerialProbe();
    activeProbe = probe;
    output.show(true);
    let rx = 0;
    let lastReport = 0;
    try {
      await probe.open(path, Number(baud), data => {
        rx += data.length;
        // OutputChannel is a probe summary, not an unbounded high-speed RX console.
        if (Date.now() - lastReport >= 1000) {
          output.appendLine(`RX total=${rx}; sample=${formatHex(data.subarray(0, 32))}`);
          lastReport = Date.now();
        }
      }, error => output.appendLine(`Serial error: ${error.message}`));
      output.appendLine(`Opened ${path}; use ECT: Stop Serial Probe to release it`);
      const text = await vscode.window.showInputBox({
        prompt: t("payloadPrompt")
      });
      if (text) {
        requireTrust();
        const data = decodeInput(text, "hex");
        await probe.send(data);
        output.appendLine(`TX locally completed: ${formatHex(data)}`);
      }
    } catch (error) {
      await probe.close().catch(() => undefined);
      if (activeProbe === probe) activeProbe = undefined;
      throw error;
    }
  });
  command("ect.tcpProbe", async () => {
    requireTrust();
    output.show(true);
    const file = join(tmpdir(), `ect-probe-${randomUUID()}.jsonl`);
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: t("tcpProbeTitle")
    }, async () => {
      const result = await runPipelineProbe(file);
      output.appendLine(JSON.stringify({ ...result, recording: file }, null, 2));
    });
  });
  command("ect.webviewProbe", async () => {
    requireTrust();
    await runBatchProbe(output);
  });
  return {
    runtime: () => ({ vscode: vscode.version, node: process.version, platform: process.platform }),
    serialAvailable: async () => { await loadSerial(); return true; },
    pipelineProbe: async () => {
      requireTrust();
      return runPipelineProbe(join(tmpdir(), `ect-host-${randomUUID()}.jsonl`));
    },
    webviewProbe: async () => {
      requireTrust();
      return runBatchProbe(output);
    }
  };
}

export async function deactivate() {
  await manager?.dispose();
  manager = undefined;
  await activeProbe?.close().catch(() => undefined);
  activeProbe = undefined;
}
