import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMMON_BAUD_RATES, DEFAULT_BAUD_RATE } from "../shared/baud-rates";
import { transportConfigSchema } from "../shared/config";
import { ConnectionForm } from "../webview/src/ConnectionForm";

test("baud presets match the requested rates and pass serial configuration validation", () => {
  assert.deepEqual([...COMMON_BAUD_RATES], [
    300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600,
    115200, 128000, 230400, 256000, 460800, 500000, 576000, 921600,
    1000000, 1500000, 2000000
  ]);
  assert.equal(DEFAULT_BAUD_RATE, 115200);
  for (const baudRate of [...COMMON_BAUD_RATES, 31250]) {
    assert.ok(transportConfigSchema.safeParse({
      kind: "serial", path: "COM7", baudRate, dataBits: 8, stopBits: 1,
      parity: "none", rtscts: false, dtr: false, rts: false
    }).success);
  }
});

test("connection form renders every baud preset, selects 115200 and offers custom input in both languages", () => {
  for (const language of ["en", "zh-CN"] as const) {
    const html = renderToStaticMarkup(React.createElement(ConnectionForm, {
      ports: [], post: () => {}, language
    }));
    for (const rate of COMMON_BAUD_RATES) {
      assert.ok(html.includes(`value="${rate}"`), String(rate));
    }
    assert.match(html, /<option value="115200" selected="">115200<\/option>/);
    assert.ok(html.includes(language === "en"
      ? '<option value="custom">Custom baud rate</option>'
      : '<option value="custom">自定义波特率</option>'));
    assert.ok(!html.includes("<datalist"));
  }
});
