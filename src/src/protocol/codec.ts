export function decodeInput(text: string, format: "hex" | "ascii"): Buffer {
  if (text.length > 256 * 1024) throw new Error("Input exceeds encoded length limit");
  let data: Buffer;
  if (format === "hex") {
    if (!/^[0-9a-fA-F\s]*$/.test(text)) throw new Error("HEX contains invalid characters");
    const hex = text.replace(/\s/g, "");
    if (hex.length % 2 !== 0) throw new Error("HEX requires an even number of digits");
    data = Buffer.from(hex, "hex");
  } else {
    if (/[^\x00-\x7f]/.test(text)) throw new Error("ASCII requires 7-bit characters");
    data = Buffer.from(text, "ascii");
  }
  if (data.length === 0 || data.length > 65536) throw new Error("Payload must be 1..65536 bytes");
  return data;
}

export function formatHex(data: Buffer): string {
  return data.toString("hex").match(/.{2}/g)?.join(" ").toUpperCase() ?? "";
}
