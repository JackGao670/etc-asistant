import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const size = 128;
const out = path.resolve(__dirname, "..", "media", "icon.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F766E"/>
      <stop offset="1" stop-color="#1E293B"/>
    </linearGradient>
    <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34D399"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <g transform="translate(22 22)">
    <rect x="16" y="16" width="52" height="52" rx="10" fill="#0B1220" stroke="url(#chip)" stroke-width="4"/>
    <rect x="28" y="28" width="28" height="28" rx="6" fill="url(#chip)" opacity="0.92"/>
    <g stroke="#22D3EE" stroke-width="5" stroke-linecap="round">
      <path d="M2 42 H14"/>
      <path d="M70 42 H82"/>
      <path d="M42 2 V14"/>
      <path d="M42 70 V82"/>
    </g>
    <g stroke="#34D399" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M6 60 C 18 50, 22 70, 30 62 S 48 54, 56 64 S 78 70, 82 58"/>
    </g>
  </g>
  <circle cx="100" cy="28" r="10" fill="#22D3EE"/>
  <circle cx="100" cy="28" r="4" fill="#0F766E"/>
</svg>`;

async function main() {
  try {
    const mod = await import("@resvg/resvg-js");
    const ResvgCtor = (mod && mod.Resvg) || mod.default;
    const resvg = new ResvgCtor(svg, { fitTo: { mode: "width", value: size } });
    const png = resvg.render().asPng();
    fs.writeFileSync(out, png);
    console.log("Wrote", out, "bytes:", png.length);
  } catch (err) {
    console.error("resvg render failed:", err && err.message);
    process.exit(1);
  }
}

main();
