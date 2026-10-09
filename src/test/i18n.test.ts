import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dictionaries, resolveLanguage, translate } from "../shared/i18n";
import { commandSchema } from "../shared/messages";

test("locale resolution follows VS Code and respects overrides", () => {
  for (const locale of ["zh-cn", "zh-TW", "zh-Hans", "zh"]) assert.equal(resolveLanguage("auto", locale), "zh-CN");
  assert.equal(resolveLanguage("auto", "de"), "en");
  assert.equal(resolveLanguage("en", "zh-cn"), "en");
  assert.equal(resolveLanguage("zh-CN", "en"), "zh-CN");
});
test("translation dictionaries have complete keys and matching placeholders", () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries["zh-CN"]).sort());
  for (const key of Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>) {
    const en = dictionaries.en[key], zh = dictionaries["zh-CN"][key];
    assert.ok(en.length && zh.length);
    assert.deepEqual(en.match(/\{\d+\}/g)?.sort(), zh.match(/\{\d+\}/g)?.sort(), key);
  }
  assert.equal(translate("en", "serialWarning", "COM7"), "Opening COM7 may reset the device through DTR/RTS. Continue?");
});
test("manifest placeholders are translated and language commands validated", () => {
  const manifest = readFileSync("package.json", "utf8");
  const en = JSON.parse(readFileSync("package.nls.json", "utf8"));
  const zh = JSON.parse(readFileSync("package.nls.zh-cn.json", "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const match of manifest.matchAll(/%([^%]+)%/g)) {
    assert.equal(typeof en[match[1]!], "string"); assert.equal(typeof zh[match[1]!], "string");
  }
  for (const language of ["auto", "en", "zh-CN"]) assert.ok(commandSchema.safeParse({
    type: "language", version: 1, requestId: "test", language
  }).success);
  assert.equal(commandSchema.safeParse({ type: "language", version: 1, requestId: "test", language: "xx" }).success, false);
});

test("empty Connections view exposes a localized workbench entry and persistent title action", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const welcome = manifest.contributes.viewsWelcome.find((item: { view: string }) => item.view === "ect.connections");
  assert.ok(welcome);
  const key = welcome.contents.slice(1, -1);
  for (const file of ["package.nls.json", "package.nls.zh-cn.json"]) {
    const strings = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(strings[key].includes("(command:ect.open)"));
  }
  assert.ok(manifest.contributes.menus["view/title"].some((item: { command: string; when: string }) =>
    item.command === "ect.open" && item.when === "view == ect.connections"));
});
