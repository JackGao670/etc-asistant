import type { Status } from "../../shared/messages";
import type { SendTarget } from "../../shared/config";

export class CommunicationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type TransportEvent =
  | { type: "data"; data: Buffer; peer?: string; boundary?: "stream" | "datagram" }
  | { type: "status"; status: Status }
  | { type: "error"; error: CommunicationError }
  | { type: "peers" };

export interface Transport {
  open(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  send(data: Buffer, signal?: AbortSignal, target?: SendTarget): Promise<number>;
  peers?(): Array<{ id: string; address: string }>;
  subscribe(listener: (event: TransportEvent) => void): { dispose(): void };
  getStatus(): Status;
  dispose(): Promise<void>;
}
