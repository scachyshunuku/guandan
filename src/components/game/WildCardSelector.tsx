"use client";

import { useState } from "react";
import { RANK_LABELS, STANDARD_RANK_ORDER, SUIT_SYMBOLS } from "@/lib/cardUtils";
import type { StandardRank, Suit } from "@/lib/types";

const SUITS: readonly Suit[] = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"];

export interface WildCardSelectorProps {
  onConfirm: (actsAs: { rank: StandardRank; suit: Suit }) => void;
  onCancel?: () => void;
}

// Shown when the player plays their level-rank heart as a wild card
// (RULES.md "Level Cards & Wild Cards": it can stand in for any card except a
// joker), to pick what it impersonates. Rank and suit are chosen
// independently — 13 ranks x 4 suits, never a joker — then Confirm submits
// the pair together, since `actsAs` needs both at once.
export default function WildCardSelector({ onConfirm, onCancel }: WildCardSelectorProps) {
  const [rank, setRank] = useState<StandardRank | null>(null);
  const [suit, setSuit] = useState<Suit | null>(null);

  return (
    <div data-testid="wild-card-selector" className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-700">Play wild card as...</p>

      <div data-testid="wild-card-rank-options" className="flex flex-wrap gap-1">
        {STANDARD_RANK_ORDER.map((r) => (
          <button
            key={r}
            type="button"
            data-testid="wild-card-rank-option"
            data-rank={r}
            aria-label={RANK_LABELS[r]}
            aria-pressed={rank === r}
            onClick={() => setRank(r)}
            className={`rounded-md border px-2 py-1 text-sm ${
              rank === r ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200"
            }`}
          >
            {RANK_LABELS[r]}
          </button>
        ))}
      </div>

      <div data-testid="wild-card-suit-options" className="flex flex-wrap gap-1">
        {SUITS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid="wild-card-suit-option"
            data-suit={s}
            aria-label={s.toLowerCase()}
            aria-pressed={suit === s}
            onClick={() => setSuit(s)}
            className={`rounded-md border px-3 py-1 text-lg ${
              suit === s ? "border-blue-500 bg-blue-50" : "border-gray-200"
            }`}
          >
            {SUIT_SYMBOLS[s]}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="wild-card-confirm-button"
          disabled={rank === null || suit === null}
          onClick={() => {
            if (rank !== null && suit !== null) onConfirm({ rank, suit });
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Confirm
        </button>
        {onCancel && (
          <button
            type="button"
            data-testid="wild-card-cancel-button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
