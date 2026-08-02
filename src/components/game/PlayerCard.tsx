"use client";

import { pluralize, teamForPosition, teamTextClass } from "@/lib/format";
import type { PlayerPosition } from "@/lib/types";

export interface PlayerCardProps {
  playerName: string;
  position: PlayerPosition;
  isConnected: boolean;
  cardCount: number;
  isCurrentTurn?: boolean;
  isSelf?: boolean;
}

// A single player's bubble on the GameTable: name, team, connection status,
// and remaining card count. Doesn't render for empty/spectator seats — the
// caller (GameTable) decides what to show there.
export default function PlayerCard({
  playerName,
  position,
  isConnected,
  cardCount,
  isCurrentTurn = false,
  isSelf = false,
}: PlayerCardProps) {
  // Team A = positions 0 & 2, Team B = positions 1 & 3 (lib/types.ts's
  // `Team` type) — shown instead of the compass seat (north/south/east/west)
  // since players care which team someone's on, not where they're sitting.
  const team = teamForPosition(position);
  const teamLabel = team === 0 ? "Team A" : "Team B";

  return (
    <div
      data-testid="player-card"
      data-position={position}
      // Fixed width (rather than sizing to content) so a long name or the
      // "Current turn" text appearing/disappearing doesn't change this
      // card's size relative to the other three rows.
      className={`flex w-32 shrink-0 flex-col items-center gap-1 rounded-lg border px-3 py-2 text-sm sm:w-36 ${
        isCurrentTurn
          ? "animate-pulse-turn border-amber-400 bg-amber-50 ring-2 ring-amber-200"
          : "border-gray-200 bg-white"
      }`}
    >
      <span
        data-testid="player-name"
        className="w-full truncate text-center font-semibold text-gray-900"
      >
        {playerName}
        {isSelf && " (You)"}
      </span>
      <span
        data-testid="team-label"
        className={`text-xs uppercase ${teamTextClass(team)}`}
      >
        {teamLabel}
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
        <span
          data-testid="current-turn-indicator"
          className="text-xs font-medium text-amber-600"
        >
          Current turn
        </span>
      )}
    </div>
  );
}
