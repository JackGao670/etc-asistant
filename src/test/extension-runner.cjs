const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async function () {
  const extension = vscode.extensions.getExtension("ect-local.ect-toolkit");
  assert.ok(extension, "Extension must be discoverable");
  const api = await extension.activate();
  assert.ok(extension.isActive);
  assert.equal(await api.serialAvailable(), true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["ect.diagnostics", "ect.serialProbe", "ect.stopProbe", "ect.tcpProbe", "ect.webviewProbe"]) {
    assert.ok(commands.includes(command), `Missing ${command}`);
  }
  await vscode.commands.executeCommand("ect.diagnostics");
  await vscode.commands.executeCommand("ect.stopProbe");
  const pipeline = await api.pipelineProbe();
  assert.equal(pipeline.sent, pipeline.received);
  console.log("ECT_HOST_PIPELINE_PASS", JSON.stringify(pipeline));
  const webview = await api.webviewProbe();
  assert.equal(webview.sentBytes, 10485760);
  assert.equal(webview.sentBytes, webview.acknowledgedBytes);
  assert.ok(webview.peakPending <= 4);
  console.log("ECT_WEBVIEW_ACK_PASS", JSON.stringify(webview));
  console.log("ECT_EXTENSION_SMOKE_PASS", JSON.stringify(api.runtime()));
};
