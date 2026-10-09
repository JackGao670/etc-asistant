import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("session label is above a single aligned control row", () => {
  const app = readFileSync("webview/src/App.tsx", "utf8");
  const section = app.slice(app.indexOf('<section className="session-section"')).split("</section>")[0]!;
  assert.match(section, /<label id="session-label" htmlFor="session-select">.*<\/label>\s*<div className="session-controls">/);
  for (const control of ['id="session-select"', 't("open")', 't("close")', 't("deleteSession")', 't("reconnect")', 'role="status"']) {
    assert.ok(section.includes(control), control);
  }
  const css = readFileSync("webview/src/style.css", "utf8");
  const row = css.slice(css.indexOf(".session-controls {")).split("}")[0]!;
  for (const declaration of ["flex-wrap: nowrap", "align-items: center", "overflow-x: auto"]) {
    assert.ok(row.includes(declaration), declaration);
  }
  assert.match(css, /\.session-controls > select, \.session-controls > button, \.session-controls > \.status \{ height: 30px;/);
});
