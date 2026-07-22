"use client";

import { PASS } from "@/lib/types";
import type { CurrentTrick, GameParticipant, PlayerPosition } from "@/lib/types";
import Card from "./Card";

export interface TrickDisplayProps {
  trick: CurrentTrick;
  participants: GameParticipant[];
}

const POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// Full detail of the current trick: one row per player (by name, not
// compass position — unlike GameTable's seat layout), their play shown to
// the right of their name. At most one play per player to show, not a
// history — see the `CurrentTrick` type comment in lib/types.ts.
export default function TrickDisplay({ trick, participants }: TrickDisplayProps) {
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

  // Looked up by each entry's own `position` rather than derived from array
  // index + leaderPosition: once a player has gone out mid-round they take
  // no further turns, so a trick's rotation doesn't necessarily visit every
  // seat in order (see the `CurrentTrick` type comment in lib/types.ts).
  const playByPosition = new Map(trick.map((entry) => [entry.position, entry.play]));

  return (
    <div data-testid="trick-display" className="flex flex-col gap-3">
      {POSITIONS.map((position) => {
        const participant = byPosition.get(position);
        // undefined means this position hasn't acted yet this trick.
        const play = playByPosition.get(position);

        return (
          <div
            key={position}
            data-testid="trick-display-player"
            data-position={position}
            // Fixed to Card's height so every row takes up the same space
            // whether the player played cards, passed, or hasn't acted yet.
            className="flex h-24 items-center gap-4"
          >
            <span
              data-testid="trick-display-name"
              className="w-20 shrink-0 text-sm font-medium text-gray-700"
            >
              {participant?.playerName ?? "—"}
            </span>
            {play === undefined ? (
              <span data-testid="trick-display-waiting" className="text-sm text-gray-300">
                —
              </span>
            ) : play === PASS ? (
              <PassCard />
            ) : (
              <div data-testid="trick-display-cards" className="flex flex-wrap gap-1">
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

// Card-shaped placeholder for a pass, sized to match Card.tsx so a row reads
// consistently whether a player played cards or passed.
function PassCard() {
  return (
    <div
      data-testid="trick-display-pass"
      className="flex h-24 w-16 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-xs font-semibold tracking-wide text-gray-400"
    >
      PASS
    </div>
  );
}
