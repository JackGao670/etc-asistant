import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ByteRing } from "../src/core/ring-buffer";
import { decodeInput, formatHex } from "../src/protocol/codec";
import { runPipelineProbe } from "../src/core/pipeline-probe";

test("ring limits bytes and count independently", () => {
  const ring = new ByteRing<string>(5, 2);
  ring.push("a", 3); ring.push("b", 3);
  assert.deepEqual(ring.snapshot(), ["b"]);
  ring.push("c", 1); ring.push("d", 1);
  assert.deepEqual(ring.snapshot(), ["c", "d"]);
  ring.push("oversized", 6);
  assert.equal(ring.bytes, 2);
  assert.equal(ring.dropped, 3);
  assert.throws(() => ring.push("bad", -1));
});

test("codec rejects malformed and oversized payloads", () => {
  assert.equal(formatHex(decodeInput("01 03\nff", "hex")), "01 03 FF");
  assert.equal(decodeInput("hello", "ascii").toString(), "hello");
  for (const value of ["0", "0x01", "GG", ""]) {
    assert.throws(() => decodeInput(value, "hex"));
  }
  assert.throws(() => decodeInput("中文", "ascii"));
  assert.throws(() => decodeInput("a".repeat(65537), "ascii"));
});

test("TCP/JSONL probe records exact bytes and bounds preview", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ect-test-"));
  try {
    const file = join(dir, "probe.jsonl");
    const result = await runPipelineProbe(file, 300, 1024 * 1024);
    assert.equal(result.sent, result.received);
    assert.ok(result.retainedBytes <= 4 * 1024 * 1024);
    const rows = (await readFile(file, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const recorded = Buffer.concat(rows.map(row => Buffer.from(row.data, "base64")));
    assert.equal(recorded.length, result.sent);
    assert.equal(createHash("sha256").update(recorded).digest("hex"), result.sha256);
    assert.deepEqual(rows.map(row => row.sequence), rows.map((_, index) => index + 1));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
