"use client";

import { PASS } from "@/lib/types";
import type { CurrentTrick, GameParticipant, PlayerPosition } from "@/lib/types";
import Card from "./Card";

export interface TrickDisplayProps {
  trick: CurrentTrick;
  leaderPosition: PlayerPosition;
  participants: GameParticipant[];
}

const POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// Full detail of the current trick: one column per player (by name, not
// compass position — unlike GameTable's seat layout), each showing that
// player's play this trick right below their name. A trick is always
// exactly one rotation (see the `CurrentTrick` type comment), so there's at
// most one play per player to show, not a history.
export default function TrickDisplay({ trick, leaderPosition, participants }: TrickDisplayProps) {
  if (trick.length === 0) {
    return (
      <div data-testid="trick-display" className="text-sm text-gray-500">
        <span data-testid="trick-display-empty">No cards played yet</span>
      </div>
    );
  }

  const byPosition = new Map(
    participants
      .filter((p): p is GameParticipant & { position: PlayerPosition } => p.position !== null)
      .map((p) => [p.position, p]),
  );

  return (
    <div data-testid="trick-display" className="flex gap-4">
      {POSITIONS.map((position) => {
        const participant = byPosition.get(position);
        // Position `position` acted at trick index (position - leaderPosition
        // + 4) % 4, per CurrentTrick's turn-order convention; undefined means
        // they haven't acted yet this trick.
        const trickIndex = (position - leaderPosition + 4) % 4;
        const play = trickIndex < trick.length ? trick[trickIndex] : undefined;

        return (
          <div
            key={position}
            data-testid="trick-display-player"
            data-position={position}
            className="flex flex-col items-center gap-1"
          >
            <span data-testid="trick-display-name" className="text-xs font-medium text-gray-700">
              {participant?.playerName ?? "—"}
            </span>
            {play === undefined ? (
              <span data-testid="trick-display-waiting" className="text-sm text-gray-300">
                —
              </span>
            ) : play === PASS ? (
              <span data-testid="trick-display-pass" className="text-sm text-gray-400">
                Pass
              </span>
            ) : (
              <div data-testid="trick-display-cards" className="flex gap-1">
                {play.map((card, cardIndex) => (
                  <Card key={cardIndex} card={card} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
