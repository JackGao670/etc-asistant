import { open } from "yauzl";
import { resolve } from "node:path";

const vsix = process.argv[2];
if (!vsix) {
  console.error("Usage: node scripts/peek-vsix.mjs <path-to.vsix>");
  process.exit(1);
}

/** @type {Map<string, (buf: Buffer) => void>} */
const targets = new Map();
const entries = [];

function readString(stream, cb) {
  /** @type {Buffer[]} */
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  stream.on("end", () => cb(Buffer.concat(chunks).toString("utf8")));
  stream.on("error", (err) => { console.error(err); process.exit(1); });
}

open(resolve(vsix), { lazyEntries: true }, (error, zip) => {
  if (error || !zip) { console.error(error); process.exit(1); return; }

  targets.set("extension/package.json", (s) => {
    const pkg = JSON.parse(s.toString());
    console.log("package.json version:", pkg.version);
    console.log("package.json icon:", pkg.icon);
    console.log("package.json readme:", pkg.readme);
    console.log("package.json repository:", JSON.stringify(pkg.repository, null, 2));
    console.log("package.json displayName:", pkg.displayName);
    console.log("package.json publisher:", pkg.publisher);
    console.log("package.json name:", pkg.name);
  });

  targets.set("extension/OVERVIEW.md", (s) => {
    const head = s.toString().split(/\r?\n/).slice(0, 20).join("\n");
    console.log("\nOVERVIEW.md (head 20 lines):\n" + head);
  });

  targets.set("extension/media/icon.png", () => {
    console.log("\nmedia/icon.png: PRESENT in VSIX");
  });

  zip.on("entry", (entry) => {
    entries.push(entry.fileName);
    const handler = targets.get(entry.fileName);
    if (handler) {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) { console.error(err); process.exit(1); return; }
        if (entry.fileName.endsWith(".png")) {
          /** @type {Buffer[]} */
          const chunks = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => { handler(Buffer.concat(chunks)); zip.readEntry(); });
          stream.on("error", (e) => { console.error(e); process.exit(1); });
        } else {
          readString(stream, (text) => { handler(Buffer.from(text)); zip.readEntry(); });
        }
      });
    } else {
      zip.readEntry();
    }
  });
  zip.on("end", () => {
    console.log("\nTotal entries:", entries.length);
    const wanted = ["extension/package.json", "extension/OVERVIEW.md", "extension/media/icon.png"];
    for (const w of wanted) {
      if (!entries.includes(w)) console.log("MISSING:", w);
    }
  });
  zip.on("error", (err) => { console.error(err); process.exit(1); });
  zip.readEntry();
});
