import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { TcpClient } from "../src/transport/tcp-client";
import { SessionManager } from "../src/session/session";
import { commandSchema } from "../shared/messages";

async function echoServer() {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.pipe(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { port, async close() {
    sockets.forEach(socket => socket.destroy());
    const closed = once(server, "close"); server.close(); await closed;
  } };
}

test("TCP open/send/receive/close and subscription release", async () => {
  const server = await echoServer();
  const client = new TcpClient("127.0.0.1", server.port);
  let resolveData!: (value: Buffer) => void;
  const data = new Promise<Buffer>(resolve => { resolveData = resolve; });
  const subscription = client.subscribe(event => { if (event.type === "data") resolveData(event.data); });
  try {
    await Promise.all([client.open(), client.open()]);
    assert.equal(client.getStatus(), "connected");
    assert.equal(await client.send(Buffer.from("hello")), 5);
    assert.equal((await data).toString(), "hello");
    await client.close(); await client.close();
    assert.equal(client.getStatus(), "closed");
    subscription.dispose();
    await client.dispose();
    await assert.rejects(client.open(), /disposed/);
  } finally { await client.dispose(); await server.close(); }
});

test("TCP close cancels an open without leaving a connected handle", async () => {
  const server = await echoServer();
  const client = new TcpClient("127.0.0.1", server.port);
  try {
    const opening = client.open();
    const rejection = assert.rejects(opening, /cancelled|closed/i);
    await client.close();
    await rejection;
    assert.equal(client.getStatus(), "closed");
    await client.open();
    assert.equal(client.getStatus(), "connected");
  } finally { await client.dispose(); await server.close(); }
});

test("sessions serialize sends and retain original bytes", async () => {
  const server = await echoServer();
  const manager = new SessionManager();
  try {
    const session = manager.createTcp("127.0.0.1", server.port);
    await session.open();
    await Promise.all(Array.from({ length: 10 }, (_, i) => session.send(Buffer.from([i]))));
    assert.equal(session.dto().txBytes, 10);
    const tx = session.records.snapshot().filter(r => r.direction === "TX");
    assert.deepEqual(tx.map(r => Buffer.from(r.data, "base64")[0]), [...Array(10).keys()]);
    session.clear();
    assert.equal(session.records.size, 0);
    await manager.remove(session.id);
    assert.equal(manager.sessions.size, 0);
  } finally { await manager.dispose(); await server.close(); }
});

test("message schema rejects unknown commands, extra fields and invalid sizes", () => {
  const base = { version: 1, requestId: "1" };
  assert.ok(commandSchema.safeParse({ ...base, type: "connect", host: "127.0.0.1", port: 5000 }).success);
  for (const bad of [
    { ...base, type: "exec", command: "shell" },
    { ...base, type: "connect", host: "a", port: 65536 },
    { ...base, type: "ready", path: "secret" },
    { ...base, type: "send", sessionId: "a", data: "a".repeat(262145), format: "hex", lineEnding: "none" }
  ]) assert.equal(commandSchema.safeParse(bad).success, false);
});

test("TCP survives 100 open/close cycles and rejects pre-aborted opens", async () => {
  const server = await echoServer();
  const client = new TcpClient("127.0.0.1", server.port);
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(client.open(controller.signal), /cancelled/i);
    for (let i = 0; i < 100; i++) {
      await client.open();
      await client.close();
      assert.equal(client.getStatus(), "closed");
    }
  } finally { await client.dispose(); await server.close(); }
});
