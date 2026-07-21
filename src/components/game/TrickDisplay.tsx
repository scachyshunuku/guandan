"use client";

import { seatLabelFor } from "@/lib/seating";
import { PASS } from "@/lib/types";
import type { CurrentTrick, PlayerPosition } from "@/lib/types";
import Card from "./Card";

export interface TrickDisplayProps {
  trick: CurrentTrick;
  leaderPosition: PlayerPosition;
  // The viewing client's own seat; null for spectators, who default to the
  // same orientation as position 0 (matches GameTable).
  myPosition: PlayerPosition | null;
}

// Full detail of the current trick: unlike GameTable's inline trick area
// (a card-count summary), this renders each play's actual cards, including
// the wild-card `actsAs` badge that Card already knows how to show.
export default function TrickDisplay({ trick, leaderPosition, myPosition }: TrickDisplayProps) {
  const anchor = myPosition ?? 0;

  if (trick.length === 0) {
    return (
      <div data-testid="trick-display" className="text-sm text-gray-500">
        <span data-testid="trick-display-empty">No cards played yet</span>
      </div>
    );
  }

  return (
    <div data-testid="trick-display" className="flex flex-col gap-2">
      {trick.map((play, i) => {
        const position = ((leaderPosition + i) % 4) as PlayerPosition;
        const seatLabel = seatLabelFor(position, anchor);
        return (
          <div
            key={i}
            data-testid="trick-display-play"
            data-position={position}
            className="flex items-center gap-2"
          >
            <span className="w-12 text-xs font-medium uppercase text-gray-500">{seatLabel}</span>
            {play === PASS ? (
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
