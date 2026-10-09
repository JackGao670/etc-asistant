import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("controls and serial popup share theme colors and native color scheme follows VS Code", () => {
  const css = readFileSync("webview/src/style.css", "utf8");
  for (const selector of ["input, select, textarea", "select option, select optgroup", ".serial-options"]) {
    const rule = css.slice(css.indexOf(`${selector} {`)).split("}")[0]!;
    assert.ok(rule.includes("var(--ect-control-background)"), selector);
    assert.ok(rule.includes("var(--ect-control-foreground)"), selector);
  }
  assert.match(css, /body\.vscode-light, body\.vscode-high-contrast-light \{ color-scheme: light; \}/);
  assert.match(css, /body\.vscode-dark, body\.vscode-high-contrast \{ color-scheme: dark; \}/);
  assert.ok(!css.includes("color-scheme: light dark"));
  assert.ok(css.includes(".serial-toggle:hover:not(:disabled)"));
});
