import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Test-only bridge; this server is excluded from VSIX and never used in production.
const bridge = `
let sessions = [], profile = {version:1,connections:[],commands:[]};
let languageSetting = localStorage.getItem("ect.language") || "auto";
function locale() { emit({type:"locale",setting:languageSetting,language:languageSetting==="auto" ? (/^zh/i.test(navigator.language) ? "zh-CN":"en") : languageSetting}); }
function emit(data) { window.dispatchEvent(new MessageEvent("message", {data})); }
window.acquireVsCodeApi = () => ({postMessage(m) {
 if(m.type === "ready") {locale();emit({type:"state",sessions});emit({type:"profile",profile});return;}
 if(m.type === "language") {languageSetting=m.language;localStorage.setItem("ect.language",m.language);locale();return;}
 if(m.type === "create") {const id="preview-"+Date.now();sessions.push({id,name:m.name,kind:m.config.kind,status:"closed",rxBytes:0,txBytes:0,dropped:0,peers:[]});}
 const s=sessions.find(s=>s.id===m.sessionId);
 if(m.type === "open" && s) s.status="connected";
 if(m.type === "close" && s) {s.status="closed";s.auto=false;}
 if(m.type === "disconnect") sessions=sessions.filter(s=>s.id!==m.sessionId);
 if(m.type === "ports") emit({type:"ports",ports:["TEST_PORT"]});
 if(m.type === "reconnect" && s) s.reconnect=m.enabled;
 if(m.type === "auto" && s) s.auto=m.enabled;
 if(m.type === "quick-save") profile.commands.push(m.command);
 if(m.type === "quick-delete") profile.commands=profile.commands.filter(c=>c.id!==m.commandId);
 if(m.type === "send" && s) {
  const raw=m.format==="hex" ? (m.data.replace(/\\s/g,"").match(/../g)||[]).map(v=>String.fromCharCode(parseInt(v,16))).join("") : m.data;
  s.txBytes+=raw.length;
  emit({type:"batch",batchId:1,bytes:raw.length,reset:false,records:[{sessionId:s.id,sequence:Date.now(),timestamp:new Date().toISOString(),direction:"TX",data:btoa(raw),byteLength:raw.length}]});
 }
 emit({type:"state",sessions:[...sessions]});emit({type:"profile",profile});
 if(m.type!=="ack") emit({type:"response",requestId:m.requestId,ok:true});
}});
`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>:root{--vscode-foreground:#ddd;--vscode-editor-background:#202124;--vscode-input-background:#303134;--vscode-input-foreground:#ddd;--vscode-button-background:#1765a5;--vscode-button-foreground:#fff;--vscode-panel-border:#555;--vscode-textCodeBlock-background:#171819;--vscode-focusBorder:#49f}</style></head><body><div id="root"></div><script>${bridge}</script><script type="module" src="/app.js"></script></body></html>`);
    } else if (req.url === "/app.js" || req.url === "/app.css") {
      res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : "text/css");
      res.end(await readFile(`dist/webview${req.url}`));
    } else { res.writeHead(404); res.end(); }
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
server.listen(5174, "127.0.0.1", () => console.log("ECT_UI_TEST_BRIDGE http://127.0.0.1:5174"));
