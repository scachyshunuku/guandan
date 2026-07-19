// Card ranking, sorting, and string encoding. See RULES.md "Cards" and
// "Level Cards & Wild Cards". Wild-card impersonation (a level-rank heart
// standing in for another card) is a play-validation concern handled in
// lib/gameRules/validation.ts, not here.

import type { Card, Rank, StandardRank, Suit } from "./types";

// ---------------------------------------------------------------------------
// Rank values
// ---------------------------------------------------------------------------

// Ascending, per RULES.md "Card Ranking (Highest to Lowest)" reversed.
export const STANDARD_RANK_ORDER: readonly StandardRank[] = Object.freeze([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
] as const);

const STANDARD_RANK_VALUE: Record<StandardRank, number> = Object.fromEntries(
  STANDARD_RANK_ORDER.map((rank, i) => [rank, i + 2]),
) as Record<StandardRank, number>;

// Level cards rank above aces but below the jokers (RULES.md "Level Cards &
// Wild Cards"); the jokers always rank above everything else.
const LEVEL_CARD_VALUE = STANDARD_RANK_VALUE.ACE + 1;
const BLACK_JOKER_VALUE = LEVEL_CARD_VALUE + 1;
const RED_JOKER_VALUE = BLACK_JOKER_VALUE + 1;

export function isStandardRank(rank: Rank): rank is StandardRank {
  return rank !== "BLACK_JOKER" && rank !== "RED_JOKER";
}

// Numeric rank for comparisons; higher is stronger. `levelRank`, if given,
// elevates matching cards to sit just below the jokers.
export function getCardRank(card: Card, levelRank?: StandardRank): number {
  if (card.rank === "RED_JOKER") return RED_JOKER_VALUE;
  if (card.rank === "BLACK_JOKER") return BLACK_JOKER_VALUE;
  if (levelRank !== undefined && card.rank === levelRank) return LEVEL_CARD_VALUE;
  return STANDARD_RANK_VALUE[card.rank];
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

// Arbitrary but fixed, only used to break ties between same-rank cards (e.g.
// duplicate suits across the two decks, or jokers) so sorting is stable.
const SUIT_ORDER: Suit[] = ["CLUBS", "DIAMONDS", "SPADES", "HEARTS"];

function getSuitOrder(suit?: Suit): number {
  return suit === undefined ? -1 : SUIT_ORDER.indexOf(suit);
}

// Ascending comparator (lowest rank first), for use with Array.sort / as a
// building block for other comparisons.
export function compareCards(
  a: Card,
  b: Card,
  levelRank?: StandardRank,
): number {
  const rankDiff = getCardRank(a, levelRank) - getCardRank(b, levelRank);
  if (rankDiff !== 0) return rankDiff;
  return getSuitOrder(a.suit) - getSuitOrder(b.suit);
}

// Returns a new array sorted ascending by rank (then suit).
export function sortCards(cards: Card[], levelRank?: StandardRank): Card[] {
  return [...cards].sort((a, b) => compareCards(a, b, levelRank));
}

// ---------------------------------------------------------------------------
// String encoding
// ---------------------------------------------------------------------------

const RANK_CODES: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  JACK: "J",
  QUEEN: "Q",
  KING: "K",
  ACE: "A",
  BLACK_JOKER: "BJ",
  RED_JOKER: "RJ",
};

const CODE_TO_RANK: Record<string, Rank> = Object.fromEntries(
  Object.entries(RANK_CODES).map(([rank, code]) => [code, rank as Rank]),
);

const SUIT_CODES: Record<Suit, string> = {
  CLUBS: "C",
  DIAMONDS: "D",
  HEARTS: "H",
  SPADES: "S",
};

const CODE_TO_SUIT: Record<string, Suit> = Object.fromEntries(
  Object.entries(SUIT_CODES).map(([suit, code]) => [code, suit as Suit]),
);

// e.g. { rank: "ACE", suit: "HEARTS" } -> "AH", { rank: "10", suit: "CLUBS" }
// -> "10C", { rank: "BLACK_JOKER" } -> "BJ".
export function encodeCard(card: Card): string {
  const rankCode = RANK_CODES[card.rank];
  if (!isStandardRank(card.rank)) return rankCode;
  if (card.suit === undefined) {
    throw new Error(`Card is missing a suit: ${JSON.stringify(card)}`);
  }
  return `${rankCode}${SUIT_CODES[card.suit]}`;
}

export function decodeCard(code: string): Card {
  if (code === "BJ") return { rank: "BLACK_JOKER" };
  if (code === "RJ") return { rank: "RED_JOKER" };

  const suitCode = code.slice(-1);
  const rankCode = code.slice(0, -1);
  const suit = CODE_TO_SUIT[suitCode];
  const rank = CODE_TO_RANK[rankCode];
  if (suit === undefined || rank === undefined || !isStandardRank(rank)) {
    throw new Error(`Invalid card code: ${code}`);
  }
  return { rank, suit };
}
