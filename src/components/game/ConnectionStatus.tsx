"use client";

import type { ConnectionStatus as ConnectionStatusValue } from "@/hooks/useGame";

export interface ConnectionStatusProps {
  status: ConnectionStatusValue;
}

// This client's own link to the games:[id] realtime channel (Task 4.2's
// useGameRealtimeSync, surfaced via Task 4.4's useGame) - not the per-player
// `isConnected` badge PlayerCard already shows (that's server-tracked and
// stays "Connected" forever until Task 6.2 adds heartbeat detection).
// Hidden while healthy ("connecting"/"connected") so it doesn't clutter the
// board - only worth a banner once this client might be missing live
// updates.
export default function ConnectionStatus({ status }: ConnectionStatusProps) {
  if (status === "connecting" || status === "connected") return null;

  const isReconnecting = status === "reconnecting";

  return (
    <div
      data-testid="connection-status-banner"
      data-status={status}
      role="status"
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
        isReconnecting ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
      }`}
    >
      {isReconnecting ? "Reconnecting…" : "Connection lost — refresh to reconnect"}
    </div>
  );
}
