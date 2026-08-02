"use client";

import { encodeCard, isRedCard, RANK_LABELS, SUIT_SYMBOLS } from "@/lib/cardUtils";
import type { CardWithWild, StandardRank } from "@/lib/types";

// Jokers aren't standard ranks, so they fall through to their raw rank
// string here — isJoker/isRedCard handle their display separately anyway.
function rankLabel(rank: CardWithWild["rank"] | StandardRank): string {
  return RANK_LABELS[rank as StandardRank] ?? rank;
}

export interface CardComponentProps {
  card: CardWithWild;
  selected?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

// Single card visual. Shows a wild-card badge when `actsAs` is present
// (RULES.md "Level Cards & Wild Cards" — a level-rank heart played as another card).
export default function Card({ card, selected = false, onClick, onKeyDown }: CardComponentProps) {
  const isJoker = card.rank === "BLACK_JOKER" || card.rank === "RED_JOKER";
  const red = isRedCard(card);
  const assetCode = encodeCard(card);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={
        isJoker
          ? `${red ? "red" : "black"} joker`
          : `${rankLabel(card.rank)}${card.suit ? ` of ${card.suit.toLowerCase()}` : ""}`
      }
      data-testid="card"
      disabled={!onClick}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`relative flex h-20 w-14 overflow-hidden rounded-xl border bg-white shadow-sm transition-transform sm:h-24 sm:w-16 ${
        selected ? "-translate-y-2 border-blue-500 ring-2 ring-blue-100" : "border-gray-200"
      } ${red ? "text-red-600" : "text-gray-900"}`}
    >
      {/* Static SVGs are intentionally served directly from /public to preserve their vector artwork. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="card-image"
        src={`/cards/${assetCode}.svg`}
        alt=""
        aria-hidden="true"
        className="pointer-events-none h-full w-full object-contain"
      />
      {card.actsAs && (
        <span
          data-testid="wild-indicator"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 shadow-sm"
        >
          as {rankLabel(card.actsAs.rank)}
          {SUIT_SYMBOLS[card.actsAs.suit]}
        </span>
      )}
    </button>
  );
}
