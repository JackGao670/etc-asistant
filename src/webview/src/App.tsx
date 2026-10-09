import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Command, HostMessage, RecordDto, SessionDto } from "../../shared/messages";
import "./style.css";
import { ConnectionForm } from "./ConnectionForm";
import type { Profile } from "../../shared/config";
import { resolveSendTarget } from "../../shared/send-target";
import { resolveLanguage, translate, type Language, type LanguageSetting, type TranslationKey } from "../../shared/i18n";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
let nextRequest = 1;
const post = (message: Omit<Command, "version" | "requestId"> | Record<string, unknown>) => {
  vscode.postMessage({ ...message, version: 1, requestId: `ui-${nextRequest++}` });
};
const ready = () => post({ type: "ready" });

function App() {
  const [language, setLanguage] = useState<Language>(resolveLanguage("auto", navigator.language));
  const [languageSetting, setLanguageSetting] = useState<LanguageSetting>("auto");
  const t = (key: TranslationKey) => translate(language, key);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [format, setFormat] = useState<"hex" | "ascii">("hex");
  const [receiveFormat, setReceiveFormat] = useState<"hex" | "ascii">("hex");
  const [filter, setFilter] = useState("");
  const [showTx, setShowTx] = useState(true);
  const [timestamps, setTimestamps] = useState(true);
  const [ending, setEnding] = useState("none");
  const [rows, setRows] = useState<RecordDto[]>([]);
  const [error, setError] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [ports, setPorts] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>({ version: 1, connections: [], commands: [] });
  const [targetId, setTargetId] = useState("");
  const [interval, setIntervalValue] = useState("1000");
  const [quickName, setQuickName] = useState("");
  const [dangerous, setDangerous] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const session = sessions.find(s => s.id === selected) ?? sessions[0];
  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      const m = event.data;
      if (m.type === "locale") { setLanguage(m.language); setLanguageSetting(m.setting); }
      if (m.type === "state") setSessions(m.sessions);
      if (m.type === "ports") setPorts(m.ports);
      if (m.type === "profile") setProfile(m.profile);
      if (m.type === "response") {
        if (m.requestId === "resync") { setRows([]); ready(); return; }
        if (!m.ok) setError(m.error ?? "Request failed");
      }
      if (m.type === "batch") {
        setRows(old => {
          const merged = m.reset ? [...m.records] : [...old, ...m.records];
          let bytes = merged.reduce((total, row) => total + row.byteLength, 0);
          while (merged.length > 10000 || bytes > 4 * 1024 * 1024) bytes -= merged.shift()!.byteLength;
          return merged;
        });
        post({ type: "ack", batchId: m.batchId, bytes: m.bytes });
      }
    };
    window.addEventListener("message", receive);
    ready();
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { document.documentElement.lang = language; document.title = translate(language, "title"); }, [language]);
  useEffect(() => {
    if (autoScroll && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [rows, autoScroll]);
  useEffect(() => { setTargetId(""); setScrollTop(0); }, [session?.id]);
  const target = resolveSendTarget(session, targetId);
  const canSend = session?.status === "connected" && (session.kind !== "tcp-server" || !!target);
  const displayedTarget = target?.kind === "broadcast" ? "*" : target?.kind === "client" ? target.clientId : "";
  const sendMessage = (type: string) => post({
    type, sessionId: session!.id, data: input, format, lineEnding: ending, target
  });
  const display = (row: RecordDto) => {
    const raw = atob(row.data);
    return Array.from(raw.slice(0, 256), c => {
      const byte = c.charCodeAt(0);
      return receiveFormat === "hex" ? byte.toString(16).padStart(2, "0").toUpperCase()
        : byte >= 32 && byte <= 126 ? c : ".";
    }).join(receiveFormat === "hex" ? " " : "") + (raw.length > 256 ? ` ... (${raw.length} ${t("bytes")})` : "");
  };
  const filtered = rows.filter(row => row.sessionId === session?.id && (showTx || row.direction !== "TX")
    && (!filter || display(row).toLowerCase().includes(filter.toLowerCase())));
  const hasSessionRows = rows.some(row => row.sessionId === session?.id);
  // Clamp the virtual window after filtering or clearing so it cannot render beyond the new list.
  const start = Math.min(Math.max(0, filtered.length - 1), Math.max(0, Math.floor(scrollTop / 28) - 5));
  const visible = filtered.slice(start, start + Math.max(40, Math.ceil((viewport.current?.clientHeight ?? 600) / 28) + 10));
  useEffect(() => { setScrollTop(0); if (viewport.current) viewport.current.scrollTop = 0; }, [filter, showTx, receiveFormat, session?.id]);
  return <main>
    <header><h1>{t("title")}</h1><span>{t("local")} · Serial / TCP / UDP</span>
      <label>{t("language")}<select value={languageSetting} onChange={e => post({ type: "language", language: e.target.value })}>
        <option value="auto">{t("automatic")}</option><option value="zh-CN">中文</option><option value="en">English</option>
      </select></label>
    </header>
    <div className="toolbar">
      <button onClick={() => post({ type: "config-load" })}>{t("loadConfig")}</button>
      <button onClick={() => post({ type: "config-save" })}>{t("saveConfig")}</button>
      <small title={t("configHint")}>{t("local")}</small>
    </div>
    <ConnectionForm ports={ports} post={post} language={language} />
    <section className="session-section" aria-labelledby="session-label">
      <label id="session-label" htmlFor="session-select">{t("session")}</label>
      <div className="session-controls">
      <select id="session-select" value={session?.id ?? ""} onChange={e => { setSelected(e.target.value); setScrollTop(0); }}>
        {!sessions.length && <option value="">{t("noSessions")}</option>}
        {sessions.map(s => <option key={s.id} value={s.id}>{s.name} [{t(s.status)}]</option>)}
      </select>
      <button disabled={!session || session.status === "connected" || session.status === "opening"} onClick={() => post({ type: "open", sessionId: session!.id })}>{t("open")}</button>
      <button disabled={!session} onClick={() => post({ type: "close", sessionId: session!.id })}>{t("close")}</button>
      <button disabled={!session} onClick={() => post({ type: "disconnect", sessionId: session!.id })}>{t("deleteSession")}</button>
      {session && ["serial", "tcp-client"].includes(session.kind ?? "") && <label>
        <input type="checkbox" checked={session.reconnect ?? false} onChange={e => post({ type: "reconnect", sessionId: session.id, enabled: e.target.checked })} />{t("reconnect")}
      </label>}
      <span className={`status ${session?.status ?? "closed"}`} role="status">{t(session?.status ?? "closed")}</span>
      </div>
    </section>
    {session?.error && <p role="alert" className="error">{session.error}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="workspace">
    <section className="receiver" aria-label={t("receive")}>
    <div className="pane-heading"><h2>{t("receive")}</h2>
      <label>{t("receiveFormat")}<select value={receiveFormat} onChange={e => setReceiveFormat(e.target.value as "hex" | "ascii")}><option value="hex">HEX</option><option value="ascii">ASCII</option></select></label>
      <label><input type="checkbox" checked={showTx} onChange={e => setShowTx(e.target.checked)} />{t("showTx")}</label>
      <input type="search" aria-label={t("filter")} placeholder={t("filter")} value={filter} onChange={e => setFilter(e.target.value)} />
      <button disabled={!session} onClick={() => post({ type: "clear", sessionId: session!.id })}>{t("clear")}</button>
    </div>
    <div className="toolbar log-tools">
      <button disabled={!session} onClick={() => post({ type: "record", sessionId: session!.id, enabled: !session?.recording })}>
        {t(session?.recording ? "stopRecord" : "startRecord")}
      </button>
      <button disabled={!session} onClick={() => post({ type: "export", sessionId: session!.id, format: "txt" })}>{t("exportTxt")}</button>
      <button disabled={!session} onClick={() => post({ type: "export", sessionId: session!.id, format: "csv" })}>{t("exportCsv")}</button>
      <span className={session?.recording ? "recording" : ""}>{t(session?.recording ? "recording" : "notRecording")}</span>
    </div>
    <div className="console" ref={viewport} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} role="log" aria-label={t("dataLog")}>
      {!filtered.length && <div className="empty-log"><strong>{t(hasSessionRows ? "noMatches" : "emptyLog")}</strong>
        <span>{t(hasSessionRows ? "noMatchesHint" : "emptyLogHint")}</span></div>}
      <div style={{ height: filtered.length * 28, position: "relative" }}>
        {visible.map((row, i) => <div className="row" key={`${row.sessionId}-${row.sequence}`} style={{ position: "absolute", top: (start + i) * 28 }}>
          {timestamps && <time>{row.timestamp.slice(11, 23)}</time>}<strong className={row.direction.toLowerCase()}>{row.direction}</strong>
          {row.peer && <span title={row.peer}>{row.peer.slice(0, 20)}</span>}
          {row.result && row.result !== "accepted" && <span title={row.error}>{t(row.result)}</span>}
          <code>{display(row)}</code>
        </div>)}
      </div>
    </div>
    </section>
    <aside className="send-pane">
    <section className="sender" aria-label={t("sendData")}>
      <div className="pane-heading"><h2>{t("sendData")}</h2>
        <label>{t("sendFormat")}<select value={format} onChange={e => setFormat(e.target.value as "hex" | "ascii")}><option value="hex">HEX</option><option value="ascii">ASCII</option></select></label>
      </div>
      {session?.kind === "tcp-server" && <>
        <label>{t("target")}<select value={displayedTarget} onChange={e => setTargetId(e.target.value)}>
          <option value="">{t("selectClient")}</option>
          <option value="*" disabled={!session.peers?.length}>{t("broadcastConfirm")}</option>
          {session.peers?.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
        </select></label>
        <small>{t(!session.peers?.length ? "noServerClients" : !target ? "selectServerTarget" : "serverTargetHint")}</small>
      </>}
      <label>{t("sendData")}<textarea value={input} onChange={e => setInput(e.target.value)} placeholder="01 03 00 10 00 02" /></label>
      <div className="toolbar">
      <label>{t("lineEnding")}<select value={ending} onChange={e => setEnding(e.target.value)}><option value="none">{t("none")}</option><option value="lf">LF</option><option value="crlf">CRLF</option></select></label>
      <button disabled={!canSend || !input} onClick={() => { setError(""); sendMessage("send"); }}>{t("send")}</button>
      <label>{t("interval")}<input type="number" min="50" value={interval} onChange={e => setIntervalValue(e.target.value)} /></label>
      <button disabled={!session?.auto && (!canSend || !input)} onClick={() => post({
        type: "auto", sessionId: session!.id, enabled: !session!.auto,
        data: input, format, lineEnding: ending, target, interval: Number(interval)
      })}>{t(session?.auto ? "stopAuto" : "autoSend")}</button>
      </div><small>{t("txHint")}</small>
    </section>
    <section className="quick">
      <h2>{t("quick")}</h2>
      <div className="toolbar">
        <label>{t("commandName")}<input value={quickName} onChange={e => setQuickName(e.target.value)} /></label>
        <label><input type="checkbox" checked={dangerous} onChange={e => setDangerous(e.target.checked)} />{t("dangerous")}</label>
        <button disabled={!input || !quickName} onClick={() => post({ type: "quick-save", command: {
          id: `quick-${Date.now()}`, name: quickName, data: input, format, lineEnding: ending, dangerous
        } })}>{t("saveCommand")}</button>
      </div>
      {!profile.commands.length && <p className="empty-quick">{t("emptyQuick")}</p>}
      {profile.commands.map(c => <div className="quick-row" key={c.id}>
        <button disabled={!canSend} onClick={() => post({ type: "quick-send", commandId: c.id, sessionId: session!.id, target })}>{c.name}{c.dangerous ? t("confirmSuffix") : ""}</button>
        <code>{c.format}: {c.data.slice(0, 80)}</code>
        <button onClick={() => { setInput(c.data); setFormat(c.format); setEnding(c.lineEnding); }}>{t("edit")}</button>
        <button onClick={() => post({ type: "quick-delete", commandId: c.id })}>{t("delete")}</button>
      </div>)}
    </section>
    </aside>
    </div>
    <footer>
      <span className="metrics">RX {session?.rxBytes ?? 0} {t("bytes")} · TX {session?.txBytes ?? 0} {t("bytes")} · {t("dropped")} {session?.dropped ?? 0}</span>
      <label><input type="checkbox" checked={timestamps} onChange={e => setTimestamps(e.target.checked)} />{t("timestamp")}</label>
      <label><input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />{t("autoScroll")}</label>
    </footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
