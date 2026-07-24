// Card ranking, sorting, and string encoding. See RULES.md "Cards" and
// "Level Cards & Wild Cards". Wild-card impersonation (a level-rank heart
// standing in for another card) is a play-validation concern handled in
// lib/gameRules/validation.ts, not here.

import type { Card, CardWithWild, Rank, StandardRank, Suit } from "./types";

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

// Short display label for each standard rank, e.g. JACK -> "J". The single
// shared source for every component that renders a rank (Card, ScoreBoard,
// WildCardSelector, ...) rather than each defining its own copy.
export const RANK_LABELS: Record<StandardRank, string> = {
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
};

// Single shared source for the suit glyphs used in Card and WildCardSelector.
export const SUIT_SYMBOLS: Record<Suit, string> = {
  CLUBS: "♣",
  HEARTS: "♥",
  SPADES: "♠",
  DIAMONDS: "♦",
};

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

// Numeric rank for comparisons; higher is stronger. Every round has a level
// (RULES.md "Level Cards & Wild Cards"), so `levelRank` is required rather
// than optional — an omitted level would silently rank that round's level
// cards as plain standard-rank cards instead of raising a type error.
export function getCardRank(card: Card, levelRank: StandardRank): number {
  if (card.rank === "RED_JOKER") return RED_JOKER_VALUE;
  if (card.rank === "BLACK_JOKER") return BLACK_JOKER_VALUE;
  if (card.rank === levelRank) return LEVEL_CARD_VALUE;
  return STANDARD_RANK_VALUE[card.rank];
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

// The four suits, in a fixed but otherwise arbitrary enumeration order —
// for callers/tests that just need "all four suits" (e.g. building a test
// deck). Not used for comparison: see compareCards below, which no longer
// breaks same-rank ties by suit at all.
export const SUIT_ORDER: readonly Suit[] = Object.freeze([
  "DIAMONDS",
  "CLUBS",
  "HEARTS",
  "SPADES",
]);

// Hearts' unique wild-card status (RULES.md "Level Cards & Wild Cards")
// makes it strictly the best suit among level-rank cards specifically —
// the other three suits remain equivalent to each other and to themselves.
function isHeartsSuit(suit: Suit | undefined): number {
  return suit === "HEARTS" ? 1 : 0;
}

// Ascending comparator (lowest rank first), for use with Array.sort / as a
// building block for other comparisons (e.g. "best card" selection for the
// card exchange). Same-rank cards are a genuine tie (0) regardless of
// suit — RULES.md "Card Ranking" never distinguishes by suit — except among
// level cards, where hearts ranks above the other three suits. This is
// deliberately *not* reflected in getCardRank, which combinations.ts also
// relies on for trick-beating: a level card played as itself (not as a
// wild substitution) beats/loses to other combos purely by rank, suit never
// enters into it there.
export function compareCards(a: Card, b: Card, levelRank: StandardRank): number {
  const rankDiff = getCardRank(a, levelRank) - getCardRank(b, levelRank);
  if (rankDiff !== 0) return rankDiff;
  if (a.rank === levelRank) {
    return isHeartsSuit(a.suit) - isHeartsSuit(b.suit);
  }
  return 0;
}

// Returns a new array sorted ascending by rank (then suit). Takes `readonly
// Card[]` (not just `Card[]`) since it only ever reads `cards` — the `[...]`
// copy is what gets sorted — so a caller holding a readonly/CardWithWild[]
// hand can pass it straight through without a cast.
export function sortCards(cards: readonly Card[], levelRank: StandardRank): Card[] {
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

// Removes `cardsToRemove` from `hand` by physical card identity (rank +
// suit, ignoring any wild-card `actsAs` claim — same semantics
// gameRules/validation.ts uses to check ownership), a multiset match rather
// than `.filter` so a duplicate (rank, suit) from the double deck only drops
// as many copies as were actually played. Callers must have already
// validated (e.g. via canPlayCards) that every card in cardsToRemove is
// physically present in hand.
export function removeCardsFromHand(
  hand: CardWithWild[],
  cardsToRemove: CardWithWild[],
): CardWithWild[] {
  const remainingToRemove = new Map<string, number>();
  for (const card of cardsToRemove) {
    const key = encodeCard(card);
    remainingToRemove.set(key, (remainingToRemove.get(key) ?? 0) + 1);
  }

  const remainingHand: CardWithWild[] = [];
  for (const card of hand) {
    const key = encodeCard(card);
    const count = remainingToRemove.get(key) ?? 0;
    if (count > 0) {
      remainingToRemove.set(key, count - 1);
    } else {
      remainingHand.push(card);
    }
  }
  return remainingHand;
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
