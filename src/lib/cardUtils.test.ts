import type { Card, CardWithWild, StandardRank, Suit } from "./types";
import {
  SUIT_ORDER,
  STANDARD_RANK_ORDER,
  compareCards,
  decodeCard,
  encodeCard,
  getCardRank,
  isStandardRank,
  removeCardsFromHand,
  sortCards,
} from "./cardUtils";

const JOKER_RANKS = ["BLACK_JOKER", "RED_JOKER"] as const;

function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of STANDARD_RANK_ORDER) {
    for (const suit of SUIT_ORDER) {
      deck.push({ rank, suit });
    }
  }
  for (const rank of JOKER_RANKS) {
    deck.push({ rank });
  }
  return deck;
}

// A level rank guaranteed not to match any of the given ranks, so a test can
// assert on un-elevated ("no level card in play") behavior even though
// getCardRank/compareCards/sortCards always require a level rank.
function levelRankExcluding(...ranks: StandardRank[]): StandardRank {
  return STANDARD_RANK_ORDER.find((r) => !ranks.includes(r))!;
}

describe("isStandardRank", () => {
  it.each(STANDARD_RANK_ORDER)("%s is a standard rank", (rank) => {
    expect(isStandardRank(rank)).toBe(true);
  });

  it.each(JOKER_RANKS)("%s is not a standard rank", (rank) => {
    expect(isStandardRank(rank)).toBe(false);
  });
});

describe("getCardRank", () => {
  it.each(STANDARD_RANK_ORDER.map((rank, i) => [rank, i + 2] as const))(
    "%s has base rank value %d (no level card in play)",
    (rank, expected) => {
      const levelRank = levelRankExcluding(rank);
      expect(getCardRank({ rank, suit: "SPADES" }, levelRank)).toBe(expected);
    },
  );

  it("black joker outranks every standard rank", () => {
    const blackJoker = getCardRank({ rank: "BLACK_JOKER" }, "2");
    for (const rank of STANDARD_RANK_ORDER) {
      expect(blackJoker).toBeGreaterThan(getCardRank({ rank, suit: "CLUBS" }, "2"));
    }
  });

  it("red joker outranks the black joker", () => {
    expect(getCardRank({ rank: "RED_JOKER" }, "2")).toBeGreaterThan(
      getCardRank({ rank: "BLACK_JOKER" }, "2"),
    );
  });

  it.each(STANDARD_RANK_ORDER)(
    "when level rank is %s, matching cards rank above ace but below the jokers",
    (levelRank) => {
      const levelValue = getCardRank({ rank: levelRank, suit: "HEARTS" }, levelRank);
      const aceValue = getCardRank({ rank: "ACE", suit: "SPADES" }, levelRank);
      const blackJokerValue = getCardRank({ rank: "BLACK_JOKER" }, levelRank);

      if (levelRank === "ACE") {
        // All aces are level cards; nothing left to compare against.
        expect(levelValue).toBeGreaterThan(blackJokerValue - 2);
      } else {
        expect(levelValue).toBeGreaterThan(aceValue);
      }
      expect(blackJokerValue).toBeGreaterThan(levelValue);
    },
  );

  it.each(STANDARD_RANK_ORDER)(
    "level rank %s does not change the rank of unrelated cards",
    (levelRank) => {
      for (const rank of STANDARD_RANK_ORDER) {
        if (rank === levelRank) continue;
        const expected = STANDARD_RANK_ORDER.indexOf(rank) + 2;
        expect(getCardRank({ rank, suit: "CLUBS" }, levelRank)).toBe(expected);
      }
    },
  );

  it("jokers are unaffected by level rank", () => {
    const blackJokerValues = STANDARD_RANK_ORDER.map((levelRank) =>
      getCardRank({ rank: "BLACK_JOKER" }, levelRank),
    );
    const redJokerValues = STANDARD_RANK_ORDER.map((levelRank) =>
      getCardRank({ rank: "RED_JOKER" }, levelRank),
    );
    expect(new Set(blackJokerValues).size).toBe(1);
    expect(new Set(redJokerValues).size).toBe(1);
  });
});

describe("compareCards", () => {
  const rankPairs: Array<[StandardRank, StandardRank]> = [];
  for (const a of STANDARD_RANK_ORDER) {
    for (const b of STANDARD_RANK_ORDER) {
      rankPairs.push([a, b]);
    }
  }

  it.each(rankPairs)("orders %s vs %s correctly", (a, b) => {
    const levelRank = levelRankExcluding(a, b);
    const result = compareCards(
      { rank: a, suit: "CLUBS" },
      { rank: b, suit: "CLUBS" },
      levelRank,
    );
    const expectedSign = Math.sign(
      STANDARD_RANK_ORDER.indexOf(a) - STANDARD_RANK_ORDER.indexOf(b),
    );
    expect(Math.sign(result)).toBe(expectedSign);
  });

  const suitPairs: Array<[Suit, Suit]> = [];
  for (const a of SUIT_ORDER) {
    for (const b of SUIT_ORDER) {
      suitPairs.push([a, b]);
    }
  }

  it.each(suitPairs)("breaks ties between same-rank %s vs %s consistently", (a, b) => {
    const levelRank = levelRankExcluding("7");
    const result = compareCards({ rank: "7", suit: a }, { rank: "7", suit: b }, levelRank);
    const expectedSign = Math.sign(SUIT_ORDER.indexOf(a) - SUIT_ORDER.indexOf(b));
    expect(Math.sign(result)).toBe(expectedSign);
  });

  it("respects level rank when ordering", () => {
    expect(
      compareCards({ rank: "5", suit: "HEARTS" }, { rank: "ACE", suit: "SPADES" }, "5"),
    ).toBeGreaterThan(0);
    expect(
      compareCards(
        { rank: "5", suit: "HEARTS" },
        { rank: "ACE", suit: "SPADES" },
        levelRankExcluding("5", "ACE"),
      ),
    ).toBeLessThan(0);
  });

  it("jokers always compare higher than standard ranks regardless of level", () => {
    for (const levelRank of STANDARD_RANK_ORDER) {
      expect(
        compareCards({ rank: "BLACK_JOKER" }, { rank: "ACE", suit: "CLUBS" }, levelRank),
      ).toBeGreaterThan(0);
      expect(
        compareCards({ rank: "RED_JOKER" }, { rank: "BLACK_JOKER" }, levelRank),
      ).toBeGreaterThan(0);
    }
  });
});

describe("sortCards", () => {
  it("sorts a full shuffled deck into non-decreasing rank order", () => {
    const deck = fullDeck();
    // Deterministic "shuffle": reverse plus a rotation.
    const shuffled = [...deck.slice(54), ...deck.slice(0, 54)].reverse();
    const levelRank = "2";
    const sorted = sortCards(shuffled, levelRank);

    for (let i = 1; i < sorted.length; i++) {
      expect(getCardRank(sorted[i], levelRank)).toBeGreaterThanOrEqual(
        getCardRank(sorted[i - 1], levelRank),
      );
    }
    expect(sorted).toHaveLength(deck.length);
  });

  it("does not mutate the input array", () => {
    const input: Card[] = [{ rank: "ACE", suit: "SPADES" }, { rank: "2", suit: "CLUBS" }];
    const copy = [...input];
    sortCards(input, "5");
    expect(input).toEqual(copy);
  });

  it.each(STANDARD_RANK_ORDER)(
    "with level rank %s, level cards sort directly below the jokers",
    (levelRank) => {
      const deck = fullDeck();
      const sorted = sortCards(deck, levelRank);
      const jokerIndex = sorted.findIndex((c) => c.rank === "BLACK_JOKER");
      const levelCardIndices = sorted
        .map((c, i) => (c.rank === levelRank ? i : -1))
        .filter((i) => i >= 0);

      for (const i of levelCardIndices) {
        expect(i).toBeLessThan(jokerIndex);
      }
      // Nothing between the level cards and the jokers.
      expect(Math.max(...levelCardIndices)).toBe(jokerIndex - 1);
    },
  );

  it("groups identical rank/suit cards from the two decks together", () => {
    const cards: Card[] = [
      { rank: "KING", suit: "HEARTS" },
      { rank: "2", suit: "CLUBS" },
      { rank: "KING", suit: "HEARTS" },
    ];
    const sorted = sortCards(cards, levelRankExcluding("KING", "2"));
    expect(sorted).toEqual([
      { rank: "2", suit: "CLUBS" },
      { rank: "KING", suit: "HEARTS" },
      { rank: "KING", suit: "HEARTS" },
    ]);
  });
});

describe("encodeCard / decodeCard", () => {
  it.each(fullDeck())("round-trips %o", (card) => {
    expect(decodeCard(encodeCard(card))).toEqual(card);
  });

  it.each([
    [{ rank: "ACE", suit: "HEARTS" } as Card, "AH"],
    [{ rank: "10", suit: "CLUBS" } as Card, "10C"],
    [{ rank: "2", suit: "SPADES" } as Card, "2S"],
    [{ rank: "JACK", suit: "DIAMONDS" } as Card, "JD"],
    [{ rank: "BLACK_JOKER" } as Card, "BJ"],
    [{ rank: "RED_JOKER" } as Card, "RJ"],
  ])("encodes %o as %s", (card, expected) => {
    expect(encodeCard(card)).toBe(expected);
  });

  it.each(["", "ZZ", "1X", "10Z", "AA"])("rejects invalid code %s", (code) => {
    expect(() => decodeCard(code)).toThrow();
  });

  it("rejects encoding a standard-rank card with a missing suit", () => {
    expect(() => encodeCard({ rank: "ACE" } as Card)).toThrow();
  });
});

describe("removeCardsFromHand", () => {
  it("removes the played cards, leaving the rest untouched", () => {
    const hand: CardWithWild[] = [
      { rank: "3", suit: "CLUBS" },
      { rank: "7", suit: "HEARTS" },
      { rank: "ACE", suit: "SPADES" },
    ];
    const result = removeCardsFromHand(hand, [{ rank: "7", suit: "HEARTS" }]);
    expect(result).toEqual([
      { rank: "3", suit: "CLUBS" },
      { rank: "ACE", suit: "SPADES" },
    ]);
  });

  it("only removes as many copies as were played from a duplicated (rank, suit)", () => {
    const hand: CardWithWild[] = [
      { rank: "KING", suit: "HEARTS" },
      { rank: "KING", suit: "HEARTS" },
      { rank: "2", suit: "CLUBS" },
    ];
    const result = removeCardsFromHand(hand, [{ rank: "KING", suit: "HEARTS" }]);
    expect(result).toEqual([
      { rank: "KING", suit: "HEARTS" },
      { rank: "2", suit: "CLUBS" },
    ]);
  });

  it("matches by physical identity, ignoring a wild card's actsAs claim", () => {
    const hand: CardWithWild[] = [{ rank: "5", suit: "HEARTS" }];
    const played: CardWithWild[] = [
      { rank: "5", suit: "HEARTS", actsAs: { rank: "KING", suit: "SPADES" } },
    ];
    expect(removeCardsFromHand(hand, played)).toEqual([]);
  });

  it("leaves the hand unchanged when nothing is played", () => {
    const hand: CardWithWild[] = [{ rank: "9", suit: "DIAMONDS" }];
    expect(removeCardsFromHand(hand, [])).toEqual(hand);
  });
});
