import { open } from "yauzl";
import { resolve } from "node:path";

open(resolve("../ect-toolkit-0.1.7-win32-x64.vsix"), { lazyEntries: true }, (error, zip) => {
  if (error || !zip) { console.error(error); process.exitCode = 1; return; }
  const entries: string[] = [];
  zip.on("entry", entry => { entries.push(entry.fileName); zip.readEntry(); });
  zip.on("error", error => { console.error(error); process.exitCode = 1; });
  zip.on("end", () => {
    const native = entries.filter(name => name.endsWith(".node") && name.includes("win32"));
    const required = ["extension/dist/extension.js", "extension/node_modules/serialport/dist/index.js",
      "extension/package.nls.json", "extension/package.nls.zh-cn.json",
      "extension/dist/webview/app.js", "extension/dist/webview/app.css", "extension/media/communication.svg"];
    const missing = required.filter(name => !entries.includes(name));
    const forbidden = entries.filter(name => name.endsWith(".log") || name.endsWith(".jsonl") ||
      name.startsWith("extension/test/") || name.startsWith("extension/.vscode/"));
    if (missing.length || native.length === 0 || forbidden.length) {
      console.error({ missing, native, forbidden }); process.exitCode = 1; return;
    }
    console.log(JSON.stringify({ entryCount: entries.length, native, requiredPresent: true }, null, 2));
  });
  zip.readEntry();
});
