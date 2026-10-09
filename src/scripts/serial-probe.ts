import { loadSerial } from "../src/transport/serial-probe";

async function main() {
  const Serial = await loadSerial();
  console.log(JSON.stringify({
    node: process.version, napi: process.versions.napi,
    platform: process.platform, arch: process.arch,
    nativeLoaded: true, ports: await Serial.list()
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
