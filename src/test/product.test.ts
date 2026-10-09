import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TcpServer, Udp } from "../src/transport/network";
import { SessionManager } from "../src/session/session";
import { Recorder, csvCell, exportLogs } from "../src/logger/logger";
import { profileSchema } from "../shared/config";

async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("Condition timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
test("TCP Server explicit targets, peer isolation, broadcast and resource release", async () => {
  const port = await freePort();
  const server = new TcpServer({ kind: "tcp-server", host: "127.0.0.1", port });
  const sockets: Socket[] = [];
  const received: string[] = [];
  server.subscribe(e => { if (e.type === "data") received.push(`${e.peer}:${e.data.toString()}`); });
  try {
    await server.open();
    for (let i = 0; i < 2; i++) {
      const socket = connect(port, "127.0.0.1"); socket.on("error", () => undefined);
      sockets.push(socket); await once(socket, "connect");
    }
    await waitFor(() => server.peers().length === 2);
    await assert.rejects(server.send(Buffer.from("x")), /Select/);
    const data = once(sockets[0]!, "data");
    await server.send(Buffer.from("target"), undefined, { kind: "client", clientId: server.peers()[0]!.id });
    assert.equal((await data)[0].toString(), "target");
    const first = once(sockets[0]!, "data"); const second = once(sockets[1]!, "data");
    assert.equal(await server.send(Buffer.from("all"), undefined, { kind: "broadcast" }), 6);
    assert.equal((await first)[0].toString(), "all"); assert.equal((await second)[0].toString(), "all");
    sockets[0]!.write("one"); sockets[1]!.write("two");
    await waitFor(() => received.length === 2);
    assert.notEqual(received[0]!.split(":")[0], received[1]!.split(":")[0]);
  } finally { sockets.forEach(s => s.destroy()); await server.dispose(); }
  const rebound = createServer(); rebound.listen(port, "127.0.0.1"); await once(rebound, "listening");
  await new Promise<void>(resolve => rebound.close(() => resolve()));
});

test("UDP preserves datagrams, source and send limit", async () => {
  const peer = createSocket("udp4"); peer.bind(0, "127.0.0.1"); await once(peer, "listening");
  const local = await freePort();
  const udp = new Udp({ kind: "udp", host: "127.0.0.1", port: local,
    remoteHost: "127.0.0.1", remotePort: peer.address().port, broadcast: false, maxDatagram: 1400 });
  const packets: Array<{ data: string; boundary?: string; peer?: string }> = [];
  udp.subscribe(e => { if (e.type === "data") packets.push({ data: e.data.toString(), boundary: e.boundary, peer: e.peer }); });
  try {
    await udp.open();
    peer.send("a", local, "127.0.0.1"); peer.send("b", local, "127.0.0.1");
    await waitFor(() => packets.length === 2);
    assert.deepEqual(packets.map(p => p.data), ["a", "b"]);
    assert.ok(packets.every(p => p.boundary === "datagram" && p.peer?.includes("127.0.0.1")));
    const message = once(peer, "message"); await udp.send(Buffer.from("back"));
    assert.equal((await message)[0].toString(), "back");
    await assert.rejects(udp.send(Buffer.alloc(1401)), /limit/);
  } finally { await udp.dispose(); peer.close(); }
});

test("recording rotates, drains and exports original bytes with CSV safety", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ect-log-test-"));
  try {
    const recorder = new Recorder(join(dir, "capture.jsonl"), () => undefined, 100000, 200, 100000);
    await recorder.start();
    for (let i = 1; i <= 5; i++) recorder.append({ sessionId: "=formula", sequence: i,
      timestamp: new Date().toISOString(), direction: "RX", data: Buffer.from([i]).toString("base64"), byteLength: 1 });
    await recorder.stop();
    assert.ok(recorder.status.files.length > 1);
    assert.equal(await exportLogs(recorder.status.files, join(dir, "export.csv"), "csv"), 5);
    const csv = await readFile(join(dir, "export.csv"), "utf8");
    assert.ok(csv.includes("'=formula")); assert.ok(csv.includes('"05"'));
    assert.equal(csvCell('a"b'), '"a""b"');
    await assert.rejects(exportLogs(recorder.status.files, join(dir, "export.csv"), "csv"), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("recording budget stops with incomplete marker instead of silent loss", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ect-budget-test-"));
  try {
    const recorder = new Recorder(join(dir, "capture.jsonl"), () => undefined, 10);
    await recorder.start();
    recorder.append({ sessionId: "s", sequence: 1, timestamp: "now", direction: "RX", data: "AA==", byteLength: 1 });
    await recorder.stop();
    assert.ok(recorder.status.error);
    assert.ok((await readFile(recorder.status.files[0]!, "utf8")).includes("incomplete"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("automatic sending pauses after close, recording survives preview clear", async () => {
  const server = createServer(socket => {
    socket.on("error", () => undefined); socket.pipe(socket);
  }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const manager = new SessionManager(); const dir = await mkdtemp(join(tmpdir(), "ect-auto-test-"));
  try {
    const session = manager.createTcp("127.0.0.1", (server.address() as { port: number }).port);
    await session.open(); await session.startRecording(join(dir, "capture.jsonl"));
    session.startAuto(Buffer.from("x"), 50);
    await waitFor(() => session.dto().txBytes >= 2);
    session.clear(); await session.close();
    const sent = session.dto().txBytes;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(session.dto().txBytes, sent); assert.equal(session.details().auto, false);
    await session.stopRecording();
    assert.ok((await readFile(join(dir, "capture.jsonl"), "utf8")).includes('"direction":"TX"'));
  } finally { await manager.dispose(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("configuration validation rejects duplicate IDs and impossible interfaces", () => {
  const config = { kind: "tcp-client", host: "localhost", port: 5000 };
  assert.equal(profileSchema.safeParse({ version: 1, connections: [
    { id: "a", name: "a", config }, { id: "a", name: "b", config }
  ], commands: [] }).success, false);
  assert.equal(profileSchema.safeParse({ version: 1, connections: [], commands: [], connected: true }).success, false);
});

test("TCP reconnect resumes connection but never resumes automatic sending", async () => {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket)); socket.pipe(socket);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const manager = new SessionManager();
  try {
    const session = manager.createTcp("127.0.0.1", (server.address() as { port: number }).port);
    await session.open(); session.setReconnect(true); session.startAuto(Buffer.from("x"), 50);
    await waitFor(() => session.dto().txBytes > 0);
    sockets.forEach(s => s.destroy());
    await waitFor(() => session.dto().status !== "connected");
    await waitFor(() => session.dto().status === "connected", 3000);
    assert.equal(session.details().auto, false);
    await session.close();
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(session.dto().status, "closed");
  } finally { await manager.dispose(); sockets.forEach(s => s.destroy()); server.close(); }
});

test("eight sessions isolate data and reject the ninth", async () => {
  const server = createServer(socket => { socket.on("error", () => undefined); socket.pipe(socket); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const manager = new SessionManager();
  try {
    const port = (server.address() as { port: number }).port;
    const sessions = Array.from({ length: 8 }, () => manager.createTcp("127.0.0.1", port));
    assert.throws(() => manager.createTcp("127.0.0.1", port), /8 sessions/);
    await Promise.all(sessions.map(s => s.open()));
    await Promise.all(sessions.map((s, i) => s.send(Buffer.from([i]))));
    await waitFor(() => sessions.every(s => s.dto().rxBytes === 1));
    sessions.forEach((s, i) => {
      const rx = s.records.snapshot().find(r => r.direction === "RX")!;
      assert.equal(Buffer.from(rx.data, "base64")[0], i);
    });
  } finally { await manager.dispose(); server.close(); }
});
