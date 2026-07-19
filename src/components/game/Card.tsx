"use client";

import { encodeCard } from "@/lib/cardUtils";
import type { CardWithWild, StandardRank, Suit } from "@/lib/types";

const SUIT_SYMBOLS: Record<Suit, string> = {
  CLUBS: "♣",
  HEARTS: "♥",
  SPADES: "♠",
  DIAMONDS: "♦",
};

const RANK_LABELS: Partial<Record<CardWithWild["rank"], string>> = {
  JACK: "J",
  QUEEN: "Q",
  KING: "K",
  ACE: "A",
};

const RED_SUITS = new Set<Suit>(["HEARTS", "DIAMONDS"]);

function rankLabel(rank: CardWithWild["rank"] | StandardRank): string {
  return RANK_LABELS[rank] ?? rank;
}

function isRed(card: CardWithWild): boolean {
  if (card.rank === "RED_JOKER") return true;
  if (card.rank === "BLACK_JOKER") return false;
  return card.suit !== undefined && RED_SUITS.has(card.suit);
}

export interface CardComponentProps {
  card: CardWithWild;
  selected?: boolean;
  onClick?: () => void;
}

// Single card visual. Shows a wild-card badge when `actsAs` is present
// (RULES.md "Level Cards & Wild Cards" — a level-rank heart played as another card).
export default function Card({ card, selected = false, onClick }: CardComponentProps) {
  const isJoker = card.rank === "BLACK_JOKER" || card.rank === "RED_JOKER";
  const red = isRed(card);
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
      className={`relative flex h-24 w-16 overflow-hidden rounded-xl border bg-white shadow-sm transition-transform ${
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
          className="absolute -top-2 -right-2 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 shadow-sm"
        >
          ≈{rankLabel(card.actsAs.rank)}
          {SUIT_SYMBOLS[card.actsAs.suit]}
        </span>
      )}
    </button>
  );
}
