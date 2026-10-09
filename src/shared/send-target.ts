import type { SendTarget } from "./config";
import type { SessionDto } from "./messages";

export function resolveSendTarget(session: SessionDto | undefined, selectedId: string): SendTarget | undefined {
  if (session?.kind !== "tcp-server") return undefined;
  const peers = session.peers ?? [];
  if (selectedId === "*") return peers.length ? { kind: "broadcast" } : undefined;
  if (selectedId) return peers.some(peer => peer.id === selectedId)
    ? { kind: "client", clientId: selectedId } : undefined;
  return peers.length === 1 ? { kind: "client", clientId: peers[0]!.id } : undefined;
}
