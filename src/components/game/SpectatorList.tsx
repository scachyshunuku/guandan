"use client";

import { pluralize } from "@/lib/format";
import type { GameParticipant } from "@/lib/types";

export interface SpectatorListProps {
  // Every participant with position === null (ARCHITECTURE.md "Spectator
  // Model") - filtered by the caller rather than taking the full
  // participants list, so this component doesn't need to know the seated/
  // spectator split rule itself.
  spectators: GameParticipant[];
}

// List of everyone watching without a seat. Renders nothing for zero
// spectators - both the waiting room and the in-progress board only want
// the section to take up space once there's something to show.
export default function SpectatorList({ spectators }: SpectatorListProps) {
  if (spectators.length === 0) return null;

  return (
    <div data-testid="spectator-list" className="text-xs text-slate-500">
      <span data-testid="spectator-list-count">{pluralize(spectators.length, "spectator")}</span>
      <span>: </span>
      <span data-testid="spectator-list-names">
        {spectators.map((s) => s.playerName).join(", ")}
      </span>
    </div>
  );
}
