"use client";

import { useState } from "react";
import { RANK_LABELS, STANDARD_RANK_ORDER, SUIT_SYMBOLS } from "@/lib/cardUtils";
import type { StandardRank, Suit } from "@/lib/types";

const SUITS: readonly Suit[] = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"];
const RED_SUITS = new Set<Suit>(["HEARTS", "DIAMONDS"]);

export interface WildCardSelectorProps {
  card: { rank: StandardRank; suit: Suit };
  onConfirm: (actsAs: { rank: StandardRank; suit: Suit }) => void;
  onCancel?: () => void;
}

// Shown for every level-rank heart in the selection (RULES.md "Level Cards &
// Wild Cards": it can stand in for any card except a joker), so the player
// always decides the interpretation instead of it being inferred from
// whether the raw play happened to already be legal. Rank and suit are
// chosen independently — 13 ranks x 4 suits, never a joker — then Confirm
// submits the pair together, since `actsAs` needs both at once. "Play as
// itself" is a shortcut for the common case of not substituting at all.
export default function WildCardSelector({ card, onConfirm, onCancel }: WildCardSelectorProps) {
  const [rank, setRank] = useState<StandardRank | null>(null);
  const [suit, setSuit] = useState<Suit | null>(null);

  return (
    <div data-testid="wild-card-selector" className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-700">Play wild card as...</p>

      <button
        type="button"
        data-testid="wild-card-play-as-itself-button"
        onClick={() => onConfirm({ rank: card.rank, suit: card.suit })}
        className="self-start rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
      >
        Play as itself ({RANK_LABELS[card.rank]} {SUIT_SYMBOLS[card.suit]})
      </button>

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
            className={`rounded-md border px-2 py-1 text-sm font-medium ${
              rank === r
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white text-gray-800 hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            {RANK_LABELS[r]}
          </button>
        ))}
      </div>

      <div data-testid="wild-card-suit-options" className="flex flex-wrap gap-1">
        {SUITS.map((s) => {
          const red = RED_SUITS.has(s);
          const selected = suit === s;
          return (
            <button
              key={s}
              type="button"
              data-testid="wild-card-suit-option"
              data-suit={s}
              aria-label={s.toLowerCase()}
              aria-pressed={selected}
              onClick={() => setSuit(s)}
              className={`rounded-md border px-3 py-1 text-lg ${
                selected
                  ? "border-blue-600 bg-blue-600 text-white"
                  : `border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50 ${
                      red ? "text-red-600" : "text-gray-900"
                    }`
              }`}
            >
              {SUIT_SYMBOLS[s]}
            </button>
          );
        })}
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
