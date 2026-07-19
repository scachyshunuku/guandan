// Deck construction, shuffling, and dealing for starting a hand. See
// RULES.md "Dealing": 2 standard decks + 4 jokers (108 cards), 27 dealt to
// each of the 4 players.

import type { Card, Suit } from "./types";
import { STANDARD_RANK_ORDER } from "./cardUtils";

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

// Shuffles a fresh deck and deals 27 cards to each of the 4 positions.
export function dealHands(): [Card[], Card[], Card[], Card[]] {
  const deck = shuffle(createDeck());
  const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
  deck.forEach((card, i) => hands[i % PLAYERS].push(card));
  return hands;
}
