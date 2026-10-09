import { z } from "zod";
import { transportConfigSchema, targetSchema, quickSchema, profileSchema } from "./config";
import type { Language, LanguageSetting } from "./i18n";

const id = z.string().min(1).max(100);
const base = { version: z.literal(1), requestId: id };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("ready") }).strict(),
  z.object({ ...base, type: z.literal("language"), language: z.enum(["auto", "en", "zh-CN"]) }).strict(),
  z.object({ ...base, type: z.literal("connect"), host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535) }).strict(),
  z.object({ ...base, type: z.literal("create"), name: z.string().trim().min(1).max(100), config: transportConfigSchema }).strict(),
  z.object({ ...base, type: z.literal("open"), sessionId: id }).strict(),
  z.object({ ...base, type: z.literal("close"), sessionId: id }).strict(),
  z.object({ ...base, type: z.literal("ports") }).strict(),
  z.object({ ...base, type: z.literal("reconnect"), sessionId: id, enabled: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("auto"), sessionId: id, enabled: z.boolean(),
    data: z.string().max(262144), format: z.enum(["hex", "ascii"]), lineEnding: z.enum(["none", "lf", "crlf"]),
    interval: z.number().int().min(50).max(3600000), target: targetSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("quick-save"), command: quickSchema }).strict(),
  z.object({ ...base, type: z.literal("quick-delete"), commandId: id }).strict(),
  z.object({ ...base, type: z.literal("quick-send"), sessionId: id, commandId: id, target: targetSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("config-save") }).strict(),
  z.object({ ...base, type: z.literal("config-load") }).strict(),
  z.object({ ...base, type: z.literal("record"), sessionId: id, enabled: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("export"), sessionId: id, format: z.enum(["txt", "csv"]) }).strict(),
  z.object({ ...base, type: z.literal("disconnect"), sessionId: id }).strict(),
  z.object({ ...base, type: z.literal("clear"), sessionId: id }).strict(),
  z.object({ ...base, type: z.literal("send"), sessionId: id,
    data: z.string().min(1).max(262144), format: z.enum(["hex", "ascii"]),
    lineEnding: z.enum(["none", "lf", "crlf"]), target: targetSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("ack"), batchId: z.number().int().positive(),
    bytes: z.number().int().min(1).max(65536) }).strict()
]);
export type Command = z.infer<typeof commandSchema>;
export type Status = "closed" | "opening" | "connected" | "closing" | "error";
export interface RecordDto {
  sessionId: string; sequence: number; timestamp: string;
  direction: "RX" | "TX"; data: string; byteLength: number;
  peer?: string; boundary?: "stream" | "datagram"; result?: "accepted" | "failed" | "unknown"; error?: string;
}
export interface SessionDto {
  id: string; name: string; status: Status; rxBytes: number; txBytes: number;
  error?: string; dropped: number;
  kind?: string; peers?: Array<{ id: string; address: string }>;
  auto?: boolean; reconnect?: boolean; recording?: boolean;
}
export type HostMessage =
  | { type: "locale"; language: Language; setting: LanguageSetting }
  | { type: "state"; sessions: SessionDto[] }
  | { type: "profile"; profile: z.infer<typeof profileSchema> }
  | { type: "ports"; ports: string[] }
  | { type: "batch"; batchId: number; bytes: number; records: RecordDto[]; reset: boolean }
  | { type: "response"; requestId: string; ok: boolean; error?: string };
