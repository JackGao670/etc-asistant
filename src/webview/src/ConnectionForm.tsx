import React, { useState } from "react";
import type { TransportConfig } from "../../shared/config";
import { translate, type Language, type TranslationKey } from "../../shared/i18n";
import { SerialPortPicker } from "./SerialPortPicker";
import { COMMON_BAUD_RATES, DEFAULT_BAUD_RATE } from "../../shared/baud-rates";

export function ConnectionForm({ ports, post, language }: { ports: string[]; post: (message: Record<string, unknown>) => void; language: Language }) {
  const t = (key: TranslationKey) => translate(language, key);
  const [kind, setKind] = useState<TransportConfig["kind"]>("serial");
  const [name, setName] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("5000");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("5001");
  const [path, setPath] = useState("");
  const [baudRate, setBaud] = useState(String(DEFAULT_BAUD_RATE));
  const [customBaud, setCustomBaud] = useState(false);
  const [dataBits, setBits] = useState("8");
  const [stopBits, setStops] = useState("1");
  const [parity, setParity] = useState("none");
  const [dtr, setDtr] = useState(false);
  const [rts, setRts] = useState(false);
  const [flow, setFlow] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [maxDatagram, setMax] = useState("1400");
  const create = () => {
    const config = kind === "serial" ? { kind, path, baudRate: Number(baudRate),
      dataBits: Number(dataBits), stopBits: Number(stopBits), parity, dtr, rts, rtscts: flow }
      : kind === "udp" ? { kind, host, port: Number(port), remoteHost, remotePort: Number(remotePort),
        broadcast, maxDatagram: Number(maxDatagram) } : { kind, host, port: Number(port) };
    post({ type: "create", name: name || `${kind} ${kind === "serial" ? path : `${host}:${port}`}`, config });
  };
  return <details className="connection-form" open><summary>{t("newConnection")}</summary>
    <div className="toolbar">
      <label>{t("type")}<select value={kind} onChange={e => setKind(e.target.value as TransportConfig["kind"])}>
        <option value="serial">{t("serial")}</option><option value="tcp-client">{t("tcpClient")}</option>
        <option value="tcp-server">{t("tcpServer")}</option><option value="udp">{t("udp")}</option>
      </select></label>
      <label>{t("name")}<input value={name} onChange={e => setName(e.target.value)} placeholder={t("optional")} /></label>
      {kind === "serial" ? <>
        <SerialPortPicker ports={ports} value={path} onChange={setPath} label={t("serialPort")}
          chooseLabel={t("choosePort")} emptyLabel={t("noPorts")} />
        <button onClick={() => post({ type: "ports" })}>{t("refreshPorts")}</button>
        <label>{t("baud")}<select value={customBaud ? "custom" : baudRate} onChange={e => {
          const custom = e.target.value === "custom";
          setCustomBaud(custom);
          if (!custom) setBaud(e.target.value);
        }}>
          {COMMON_BAUD_RATES.map(rate => <option key={rate} value={String(rate)}>{rate}</option>)}
          <option value="custom">{t("customBaud")}</option>
        </select></label>
        {customBaud && <label>{t("customBaud")}<input type="number" min="1" max="3000000" step="1"
          value={baudRate} onChange={e => setBaud(e.target.value)} /></label>}
        <label>{t("dataBits")}<select value={dataBits} onChange={e => setBits(e.target.value)}><option>8</option><option>7</option></select></label>
        <label>{t("stopBits")}<select value={stopBits} onChange={e => setStops(e.target.value)}><option>1</option><option>2</option></select></label>
        <label>{t("parity")}<select value={parity} onChange={e => setParity(e.target.value)}>
          <option value="none">{t("none")}</option><option value="even">{t("even")}</option><option value="odd">{t("odd")}</option>
        </select></label>
        <label><input type="checkbox" checked={dtr} onChange={e => setDtr(e.target.checked)} />DTR</label>
        <label><input type="checkbox" checked={rts} disabled={flow} onChange={e => setRts(e.target.checked)} />RTS</label>
        <label><input type="checkbox" checked={flow} onChange={e => setFlow(e.target.checked)} />RTS/CTS</label>
      </> : <>
        <label>{t(kind === "tcp-client" ? "host" : "bind")}<input value={host} onChange={e => setHost(e.target.value)} /></label>
        <label>{t("port")}<input type="number" value={port} onChange={e => setPort(e.target.value)} /></label>
        {kind === "udp" && <>
          <label>{t("remoteHost")}<input value={remoteHost} onChange={e => setRemoteHost(e.target.value)} /></label>
          <label>{t("remotePort")}<input type="number" value={remotePort} onChange={e => setRemotePort(e.target.value)} /></label>
          <label>{t("maxDatagram")}<input type="number" value={maxDatagram} onChange={e => setMax(e.target.value)} /></label>
          <label><input type="checkbox" checked={broadcast} onChange={e => setBroadcast(e.target.checked)} />{t("broadcast")}</label>
        </>}
      </>}
      <button onClick={create}>{t("create")}</button>
    </div><small>{t("createHint")}</small>
  </details>;
}
