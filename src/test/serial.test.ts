import { test } from "node:test";
import assert from "node:assert/strict";
import { SerialPortMock } from "serialport";
import { Serial } from "../src/transport/serial";
import type { loadSerial } from "../src/transport/serial-probe";

test("serial mock validates open/signals/write/drain/receive/close lifecycle", async () => {
  SerialPortMock.binding.createPort("TEST_SERIAL", { echo: true, record: true });
  const transport = new Serial({ kind: "serial", path: "TEST_SERIAL", baudRate: 115200,
    dataBits: 8, stopBits: 1, parity: "none", rtscts: false, dtr: false, rts: false },
    (async () => SerialPortMock) as unknown as typeof loadSerial);
  let resolveData!: (value: Buffer) => void;
  const received = new Promise<Buffer>(resolve => { resolveData = resolve; });
  transport.subscribe(e => { if (e.type === "data") resolveData(e.data); });
  try {
    await transport.open();
    assert.equal(transport.getStatus(), "connected");
    assert.equal(await transport.send(Buffer.from([1, 2, 255])), 3);
    assert.deepEqual(await received, Buffer.from([1, 2, 255]));
    await assert.rejects(transport.send(Buffer.from([1]), undefined, { kind: "broadcast" }), /target/);
    await transport.close(); assert.equal(transport.getStatus(), "closed");
    await transport.open(); await transport.close();
  } finally { await transport.dispose(); SerialPortMock.binding.reset(); }
});
