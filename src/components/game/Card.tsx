"use client";

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
  BLACK_JOKER: "JOKER",
  RED_JOKER: "JOKER",
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

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${rankLabel(card.rank)}${card.suit ? ` of ${card.suit.toLowerCase()}` : ""}`}
      data-testid="card"
      disabled={!onClick}
      onClick={onClick}
      className={`relative flex h-24 w-16 flex-col items-center justify-center rounded-lg border-2 bg-white font-bold shadow-sm transition-transform ${
        selected ? "-translate-y-2 border-blue-500" : "border-gray-300"
      } ${red ? "text-red-600" : "text-gray-900"}`}
    >
      <span className="text-lg leading-none">{rankLabel(card.rank)}</span>
      {!isJoker && card.suit && (
        <span className="text-2xl leading-none">{SUIT_SYMBOLS[card.suit]}</span>
      )}
      {card.actsAs && (
        <span
          data-testid="wild-indicator"
          className="absolute bottom-1 rounded bg-yellow-200 px-1 text-[10px] font-normal text-gray-800"
        >
          as {rankLabel(card.actsAs.rank)}
          {SUIT_SYMBOLS[card.actsAs.suit]}
        </span>
      )}
    </button>
  );
}
