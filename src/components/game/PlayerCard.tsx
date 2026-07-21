"use client";

import { pluralize } from "@/lib/format";
import type { SeatLabel } from "@/lib/seating";
import type { PlayerPosition } from "@/lib/types";

export interface PlayerCardProps {
  playerName: string;
  position: PlayerPosition;
  seatLabel: SeatLabel;
  isConnected: boolean;
  cardCount: number;
  isCurrentTurn?: boolean;
  isSelf?: boolean;
}

// A single player's bubble on the GameTable: name, seat, connection status,
// and remaining card count. Doesn't render for empty/spectator seats — the
// caller (GameTable) decides what to show there.
export default function PlayerCard({
  playerName,
  position,
  seatLabel,
  isConnected,
  cardCount,
  isCurrentTurn = false,
  isSelf = false,
}: PlayerCardProps) {
  return (
    <div
      data-testid="player-card"
      data-position={position}
      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-sm ${
        isCurrentTurn
          ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
          : "border-gray-200 bg-white"
      }`}
    >
      <span data-testid="player-name" className="font-semibold text-gray-900">
        {playerName}
        {isSelf && " (You)"}
      </span>
      <span data-testid="seat-label" className="text-xs uppercase text-gray-400">
        {seatLabel}
      </span>
      <span
        data-testid="connection-status"
        className={`text-xs ${isConnected ? "text-emerald-600" : "text-red-500"}`}
      >
        {isConnected ? "Connected" : "Disconnected"}
      </span>
      <span data-testid="card-count" className="text-xs text-gray-500">
        {pluralize(cardCount, "card")}
      </span>
      {isCurrentTurn && (
        <span data-testid="current-turn-indicator" className="text-xs font-medium text-amber-600">
          Current turn
        </span>
      )}
    </div>
  );
}
