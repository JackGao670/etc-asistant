import { z } from "zod";

const address = z.string().trim().min(1).max(253).refine(s => !/\s/.test(s), "Address contains whitespace");
const port = z.number().int().min(1).max(65535);
const ipv4 = z.string().refine(s => {
  const parts = s.split(".");
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}, "IPv4 address required");
export const transportConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tcp-client"), host: address, port }).strict(),
  z.object({ kind: z.literal("tcp-server"), host: ipv4, port }).strict(),
  z.object({ kind: z.literal("udp"), host: ipv4, port, remoteHost: ipv4,
    remotePort: port, broadcast: z.boolean().default(false), maxDatagram: z.number().int().min(1).max(65507).default(1400) }).strict(),
  z.object({ kind: z.literal("serial"), path: z.string().trim().min(1).max(256),
    baudRate: z.number().int().min(1).max(3000000), dataBits: z.union([z.literal(7), z.literal(8)]),
    stopBits: z.union([z.literal(1), z.literal(2)]), parity: z.enum(["none", "even", "odd"]),
    rtscts: z.boolean(), dtr: z.boolean(), rts: z.boolean() }).strict()
]);
export type TransportConfig = z.infer<typeof transportConfigSchema>;
export const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), clientId: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal("broadcast") }).strict()
]);
export type SendTarget = z.infer<typeof targetSchema>;
export const quickSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100),
  data: z.string().min(1).max(262144), format: z.enum(["hex", "ascii"]),
  lineEnding: z.enum(["none", "lf", "crlf"]), dangerous: z.boolean().default(false)
}).strict();
export type QuickCommand = z.infer<typeof quickSchema>;
export const profileSchema = z.object({
  version: z.literal(1),
  connections: z.array(z.object({ id: z.string().min(1).max(100),
    name: z.string().min(1).max(100), config: transportConfigSchema }).strict()).max(8),
  commands: z.array(quickSchema).max(100)
}).strict().superRefine((p, ctx) => {
  for (const values of [p.connections, p.commands]) {
    if (new Set(values.map(v => v.id)).size !== values.length) ctx.addIssue({
      code: z.ZodIssueCode.custom, message: "Duplicate IDs"
    });
  }
});
export type Profile = z.infer<typeof profileSchema>;
