"use client";

import { useState } from "react";
import type { CardWithWild } from "@/lib/types";
import Card from "./Card";

export interface PlayerHandProps {
  hand: CardWithWild[];
  // False for other players' hands (e.g. rendered elsewhere on the table) —
  // only the viewing player's own hand is shown face up.
  isOwnHand?: boolean;
  selectedIndices?: number[];
  onSelectionChange?: (selectedIndices: number[]) => void;
}

// Player's hand: a grid of cards from the viewing player's own hand, with
// click-to-select. Selection state is controlled if `selectedIndices` /
// `onSelectionChange` are given, otherwise it's managed internally.
export default function PlayerHand({
  hand,
  isOwnHand = true,
  selectedIndices,
  onSelectionChange,
}: PlayerHandProps) {
  const [internalSelected, setInternalSelected] = useState<number[]>([]);
  const selected = selectedIndices ?? internalSelected;

  function toggleCard(index: number) {
    if (onSelectionChange) {
      const next = selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index];
      onSelectionChange(next);
    } else {
      setInternalSelected((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      );
    }
  }

  if (!isOwnHand) {
    return (
      <div data-testid="player-hand-hidden" className="flex gap-1">
        {hand.map((_, index) => (
          <div
            key={index}
            data-testid="card-back"
            className="h-24 w-16 rounded-lg border-2 border-emerald-950 bg-emerald-700"
          />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="player-hand" className="flex flex-wrap gap-1">
      {hand.map((card, index) => (
        <Card
          key={index}
          card={card}
          selected={selected.includes(index)}
          onClick={() => toggleCard(index)}
        />
      ))}
    </div>
  );
}
