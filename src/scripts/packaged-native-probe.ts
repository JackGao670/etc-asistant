import { open } from "yauzl";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { pipeline } from "node:stream/promises";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ect-vsix-"));
  try {
    await new Promise<void>((done, fail) => {
      open(resolve("../ect-toolkit-0.1.7-win32-x64.vsix"), { lazyEntries: true }, (error, zip) => {
        if (error || !zip) { fail(error); return; }
        zip.on("error", fail);
        zip.on("end", done);
        zip.on("entry", entry => {
          const destination = resolve(dir, entry.fileName);
          if (!destination.startsWith(dir + sep)) { zip.close(); fail(new Error("Unsafe archive path")); return; }
          const extract = async () => {
            if (entry.fileName.endsWith("/")) {
              await mkdir(destination, { recursive: true });
              return;
            }
            await mkdir(dirname(destination), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) => {
              zip.openReadStream(entry, (error, stream) => {
                if (error || !stream) reject(error); else resolveStream(stream);
              });
            });
            await pipeline(stream, createWriteStream(destination));
          };
          extract().then(() => zip.readEntry()).catch(error => { zip.close(); fail(error); });
        });
        zip.readEntry();
      });
    });
    // Load in a child process so Windows releases the native DLL before cleanup.
    const { stdout } = await promisify(execFile)(process.execPath, [
      "-e",
      "const {SerialPort}=require('serialport');SerialPort.list().then(p=>console.log(p.length)).catch(e=>{console.error(e);process.exitCode=1})"
    ], { cwd: join(dir, "extension") });
    console.log(JSON.stringify({
      nativeLoadedFromExtractedVSIX: true, platform: process.platform,
      arch: process.arch, node: process.version, portCount: Number(stdout.trim()),
      limitation: "Build machine Node runtime, not clean-machine or VS Code Host certification"
    }, null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
