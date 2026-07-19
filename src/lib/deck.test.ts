import type { Card } from "./types";
import { encodeCard } from "./cardUtils";
import { createDeck, dealHands, shuffle } from "./deck";

function multiset(cards: Card[]): string[] {
  return cards.map(encodeCard).sort();
}

describe("createDeck", () => {
  it("has 108 cards: 2 standard decks + 4 jokers", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
  });

  it("has exactly 2 of every standard card and 2 of each joker", () => {
    const counts = new Map<string, number>();
    for (const card of createDeck()) {
      const key = encodeCard(card);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get("BJ")).toBe(2);
    expect(counts.get("RJ")).toBe(2);
    const nonJokerCounts = [...counts.entries()].filter(
      ([key]) => key !== "BJ" && key !== "RJ",
    );
    expect(nonJokerCounts).toHaveLength(52);
    for (const [, count] of nonJokerCounts) {
      expect(count).toBe(2);
    }
  });
});

describe("shuffle", () => {
  it("returns an array with the same elements", () => {
    const input = [1, 2, 3, 4, 5];
    expect(shuffle(input).sort()).toEqual(input.sort());
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it("can produce a different order (probabilistic)", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const shuffledOnce = shuffle(input);
    expect(shuffledOnce).not.toEqual(input);
  });
});

describe("dealHands", () => {
  it("deals 4 hands of 27 cards each", () => {
    const hands = dealHands();
    expect(hands).toHaveLength(4);
    for (const hand of hands) {
      expect(hand).toHaveLength(27);
    }
  });

  it("deals the full 108-card deck with no duplicates or omissions", () => {
    const hands = dealHands();
    const dealt = multiset(hands.flat());
    const full = multiset(createDeck());
    expect(dealt).toEqual(full);
  });
});
