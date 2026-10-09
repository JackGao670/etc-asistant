import { test } from "node:test";
import assert from "node:assert/strict";
import { AckWindow } from "../src/core/ack-window";

test("ACK window limits inflight data and rejects forged or duplicate ACK", () => {
  const window = new AckWindow();
  const ids = Array.from({ length: 4 }, () => window.reserve(65536, 100)!);
  assert.equal(window.reserve(1, 100), undefined);
  assert.equal(window.acknowledge(ids[0]!, 1, 120), false);
  assert.equal(window.acknowledge(999, 65536, 120), false);
  assert.equal(window.size, 4);
  assert.equal(window.acknowledge(ids[0]!, 65536, 120), true);
  assert.equal(window.acknowledge(ids[0]!, 65536, 120), false);
  assert.equal(window.size, 3);
  assert.equal(window.acknowledgedBytes, 65536);
  assert.deepEqual(window.latencies, [20]);
  assert.ok(window.reserve(100, 130));
  assert.equal(window.peakPending, 4);
});

test("ACK window enforces batch size and timeout", () => {
  const window = new AckWindow();
  assert.throws(() => window.reserve(0, 0));
  assert.throws(() => window.reserve(65537, 0));
  window.reserve(1, 100);
  assert.equal(window.expired(5099, 5000), false);
  assert.equal(window.expired(5100, 5000), true);
});

test("reset never reuses batch IDs or accepts old ACKs", () => {
  const window = new AckWindow();
  const old = window.reserve(10, 0)!;
  window.reset();
  const current = window.reserve(10, 1)!;
  assert.ok(current > old);
  assert.equal(window.acknowledge(old, 10, 2), false);
  assert.equal(window.size, 1);
});
