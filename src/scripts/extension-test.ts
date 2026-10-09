import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";

async function main() {
  const executable = process.env.ECT_TEST_EXECUTABLE;
  const isolation = await mkdtemp(resolve(tmpdir(), "ect-host-test-"));
  try {
    console.log(JSON.stringify({ executable: executable ?? "Official VS Code download", isolation }));
    await runTests({
      ...(executable ? { vscodeExecutablePath: executable } : { version: process.argv[2] ?? "1.95.0" }),
      cachePath: resolve(tmpdir(), "ect-vscode-test-cache"),
      extensionDevelopmentPath: resolve("."),
      extensionTestsPath: resolve("test/extension-runner.cjs"),
      launchArgs: [
        "--disable-gpu", "--skip-welcome", "--skip-release-notes",
        "--disable-workspace-trust", "--disable-extensions",
        `--user-data-dir=${resolve(isolation, "user")}`,
        `--extensions-dir=${resolve(isolation, "extensions")}`
      ]
    });
  } finally {
    await rm(isolation, { recursive: true, force: true, maxRetries: 3 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
