// Deck construction, shuffling, and dealing for starting a hand. See
// RULES.md "Dealing": 2 standard decks + 4 jokers (108 cards), 27 dealt to
// each of the 4 players.

import type { Card, StandardRank, Suit } from "./types";
import { sortCards, STANDARD_RANK_ORDER } from "./cardUtils";

const SUITS: readonly Suit[] = Object.freeze([
  "CLUBS",
  "DIAMONDS",
  "HEARTS",
  "SPADES",
]);

const DECKS_PER_GAME = 2;
const PLAYERS = 4;

// One shuffled 108-card set (2 standard decks + 4 jokers), unshuffled order.
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let i = 0; i < DECKS_PER_GAME; i++) {
    for (const suit of SUITS) {
      for (const rank of STANDARD_RANK_ORDER) {
        deck.push({ suit, rank });
      }
    }
    deck.push({ rank: "BLACK_JOKER" });
    deck.push({ rank: "RED_JOKER" });
  }
  return deck;
}

// Fisher-Yates shuffle. Returns a new array; does not mutate the input.
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Shuffles a fresh deck and deals 27 cards to each of the 4 positions, each
// hand pre-sorted low-to-high (via cardUtils.sortCards) so a player's hand
// starts out organized rather than in raw deal order. This is a one-time
// presentational sort at deal time only — nothing re-sorts a hand as cards
// are added or removed afterward (by play or card exchange), so anything
// that needs e.g. the single highest card in a hand *after* dealing (the
// card exchange's "best card") must sort for itself rather than assume this
// order still holds.
export function dealHands(levelRank: StandardRank): [Card[], Card[], Card[], Card[]] {
  const deck = shuffle(createDeck());
  const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
  deck.forEach((card, i) => hands[i % PLAYERS].push(card));
  return hands.map((hand) => sortCards(hand, levelRank)) as [Card[], Card[], Card[], Card[]];
}
