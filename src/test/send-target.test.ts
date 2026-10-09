import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolveSendTarget } from "../shared/send-target";
import type { SessionDto } from "../shared/messages";
import { SessionManager } from "../src/session/session";

const session = (peers: SessionDto["peers"]): SessionDto => ({
  id: "server", name: "server", kind: "tcp-server", status: "connected",
  rxBytes: 0, txBytes: 0, dropped: 0, peers
});

test("server target defaults only to a sole client and rejects missing or stale targets", () => {
  const a = { id: "a", address: "127.0.0.1:1" }, b = { id: "b", address: "127.0.0.1:2" };
  assert.equal(resolveSendTarget(session([]), ""), undefined);
  assert.equal(resolveSendTarget(session([]), "*"), undefined);
  assert.deepEqual(resolveSendTarget(session([a]), ""), { kind: "client", clientId: "a" });
  assert.equal(resolveSendTarget(session([a, b]), ""), undefined);
  assert.deepEqual(resolveSendTarget(session([a, b]), "b"), { kind: "client", clientId: "b" });
  assert.deepEqual(resolveSendTarget(session([a, b]), "*"), { kind: "broadcast" });
  assert.equal(resolveSendTarget(session([b]), "a"), undefined);
  assert.equal(resolveSendTarget({ ...session([a]), kind: "tcp-client" }, "a"), undefined);
});

test("local ECT server replies to ECT client using the UI-resolved target", { timeout: 5000 }, async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const manager = new SessionManager();
  const server = manager.create({ kind: "tcp-server", host: "127.0.0.1", port }, "server");
  const client = manager.createTcp("127.0.0.1", port);
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Condition timed out");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  try {
    await server.open(); await client.open();
    await waitFor(() => server.details().peers?.length === 1);
    await client.send(Buffer.from("request"));
    await waitFor(() => server.dto().rxBytes === 7);
    const target = resolveSendTarget(server.details(), "");
    assert.ok(target);
    await server.send(Buffer.from("reply"), target);
    await waitFor(() => client.dto().rxBytes === 5);
    assert.equal(server.dto().txBytes, 5);
    assert.equal(Buffer.from(client.records.snapshot().find(row => row.direction === "RX")!.data, "base64").toString(), "reply");
    await client.close();
    await waitFor(() => server.details().peers?.length === 0);
    assert.equal(resolveSendTarget(server.details(), ""), undefined);
  } finally { await manager.dispose(); }
});
