import type { Card, JokerRank, StandardRank, Suit } from "../types";
import { STANDARD_RANK_ORDER, SUIT_ORDER } from "../cardUtils";
import {
  BOMB_TYPE_ORDER,
  getComboRank,
  getComboType,
  isBombComboType,
  isJokerBomb,
  isStraightFlush,
  isValidBomb,
  isValidFullHouse,
  isValidPair,
  isValidPlate,
  isValidSingle,
  isValidStraight,
  isValidTriple,
  isValidTube,
} from "./combinations";

const JOKER_RANKS: readonly JokerRank[] = ["BLACK_JOKER", "RED_JOKER"];

function c(rank: StandardRank, suit: Suit): Card {
  return { rank, suit };
}

function j(rank: JokerRank): Card {
  return { rank };
}

// n cards of the same standard rank, cycling suits (duplicate suits are fine
// here — they just represent the second deck / a resolved wild card).
function nOfRank(rank: StandardRank, n: number): Card[] {
  return Array.from({ length: n }, (_, i) => c(rank, SUIT_ORDER[i % SUIT_ORDER.length]));
}

// `length` consecutive ranks starting at `startIndex`, one card per rank.
function straightFrom(startIndex: number, length: number, suit?: Suit): Card[] {
  return STANDARD_RANK_ORDER.slice(startIndex, startIndex + length).map((rank, i) => ({
    rank,
    suit: suit ?? SUIT_ORDER[i % SUIT_ORDER.length],
  }));
}

function tubeFrom(startIndex: number): Card[] {
  return STANDARD_RANK_ORDER.slice(startIndex, startIndex + 3).flatMap((rank) => nOfRank(rank, 2));
}

function plateFrom(startIndex: number): Card[] {
  return STANDARD_RANK_ORDER.slice(startIndex, startIndex + 3 - 1).flatMap((rank) => nOfRank(rank, 3));
}

// All valid straight start indices for a given length (no wraparound).
function straightStarts(length: number): number[] {
  const starts: number[] = [];
  for (let start = 0; start + length <= STANDARD_RANK_ORDER.length; start++) {
    starts.push(start);
  }
  return starts;
}

describe("isValidSingle", () => {
  it.each(STANDARD_RANK_ORDER)("a single %s is valid", (rank) => {
    expect(isValidSingle([c(rank, "SPADES")])).toBe(true);
  });

  it.each(JOKER_RANKS)("a single %s is valid", (rank) => {
    expect(isValidSingle([j(rank)])).toBe(true);
  });

  it("zero cards is invalid", () => {
    expect(isValidSingle([])).toBe(false);
  });

  it("two cards is invalid", () => {
    expect(isValidSingle([c("3", "SPADES"), c("3", "CLUBS")])).toBe(false);
  });
});

describe("isValidPair", () => {
  it.each(STANDARD_RANK_ORDER)("two %ss is a valid pair", (rank) => {
    expect(isValidPair(nOfRank(rank, 2))).toBe(true);
  });

  it("two red jokers is a valid pair", () => {
    expect(isValidPair([j("RED_JOKER"), j("RED_JOKER")])).toBe(true);
  });

  it.each(STANDARD_RANK_ORDER.slice(1))("a 2 and a %s is not a valid pair", (rank) => {
    expect(isValidPair([c("2", "SPADES"), c(rank, "CLUBS")])).toBe(false);
  });

  it("a single card is not a valid pair", () => {
    expect(isValidPair([c("5", "SPADES")])).toBe(false);
  });

  it("three of the same rank is not a valid pair", () => {
    expect(isValidPair(nOfRank("5", 3))).toBe(false);
  });
});

describe("isValidTriple", () => {
  it.each(STANDARD_RANK_ORDER)("three %ss is a valid triple", (rank) => {
    expect(isValidTriple(nOfRank(rank, 3))).toBe(true);
  });

  it.each(STANDARD_RANK_ORDER.slice(1))("two 2s and a %s is not a valid triple", (rank) => {
    expect(isValidTriple([c("2", "SPADES"), c("2", "CLUBS"), c(rank, "HEARTS")])).toBe(false);
  });

  it("a pair is not a valid triple", () => {
    expect(isValidTriple(nOfRank("5", 2))).toBe(false);
  });

  it("four of the same rank is not a valid triple", () => {
    expect(isValidTriple(nOfRank("5", 4))).toBe(false);
  });
});

describe("isValidFullHouse", () => {
  it.each(STANDARD_RANK_ORDER.slice(1))("triple 2s + pair %ss is a valid full house", (pairRank) => {
    expect(isValidFullHouse([...nOfRank("2", 3), ...nOfRank(pairRank, 2)])).toBe(true);
  });

  it.each(STANDARD_RANK_ORDER.slice(0, -1))("pair %ss + triple aces is a valid full house", (pairRank) => {
    expect(isValidFullHouse([...nOfRank(pairRank, 2), ...nOfRank("ACE", 3)])).toBe(true);
  });

  it("two triples is not a valid full house", () => {
    expect(isValidFullHouse([...nOfRank("2", 3), ...nOfRank("3", 2), c("4", "SPADES")])).toBe(false);
  });

  it("a single triple (3 cards) is not a valid full house", () => {
    expect(isValidFullHouse(nOfRank("5", 3))).toBe(false);
  });

  it("three distinct ranks (3+1+1) is not a valid full house", () => {
    expect(
      isValidFullHouse([...nOfRank("2", 3), c("3", "SPADES"), c("4", "SPADES")]),
    ).toBe(false);
  });

  it("four of a kind + one is not a valid full house", () => {
    expect(isValidFullHouse([...nOfRank("2", 4), c("3", "SPADES")])).toBe(false);
  });

  it("two pairs + a single (2+2+1) is not a valid full house", () => {
    expect(isValidFullHouse([...nOfRank("2", 2), ...nOfRank("3", 2), c("4", "SPADES")])).toBe(false);
  });

  it("a triple + a joker pair is a valid full house (consistent with isValidPair treating same-rank jokers as a pair)", () => {
    expect(isValidFullHouse([...nOfRank("5", 3), j("RED_JOKER"), j("RED_JOKER")])).toBe(true);
  });
});

describe("isValidStraight", () => {
  for (const length of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    it.each(straightStarts(length))(`a ${length}-run starting at index %i is a valid straight`, (start) => {
      expect(isValidStraight(straightFrom(start, length))).toBe(true);
    });
  }

  it.each([1, 2, 3, 4])("a run of length %i is too short to be a straight", (length) => {
    expect(isValidStraight(straightFrom(0, length))).toBe(false);
  });

  it("K-A-2 does not wrap around into a valid straight", () => {
    expect(isValidStraight([c("KING", "SPADES"), c("ACE", "SPADES"), c("2", "SPADES")])).toBe(false);
  });

  it("a gap in the run is not a valid straight", () => {
    expect(
      isValidStraight([
        c("3", "SPADES"),
        c("4", "SPADES"),
        c("6", "SPADES"),
        c("7", "SPADES"),
        c("8", "SPADES"),
      ]),
    ).toBe(false);
  });

  it("a duplicated rank is not a valid straight", () => {
    expect(
      isValidStraight([
        c("3", "SPADES"),
        c("3", "CLUBS"),
        c("5", "SPADES"),
        c("6", "SPADES"),
        c("7", "SPADES"),
      ]),
    ).toBe(false);
  });

  it.each(JOKER_RANKS)("a run containing a %s is not a valid straight", (rank) => {
    expect(isValidStraight([...straightFrom(0, 4), j(rank)])).toBe(false);
  });
});

describe("isValidTube", () => {
  it.each(straightStarts(3))("three consecutive pairs starting at index %i is a valid tube", (start) => {
    expect(isValidTube(tubeFrom(start))).toBe(true);
  });

  it("three consecutive pairs with a gap is not a valid tube", () => {
    expect(isValidTube([...nOfRank("3", 2), ...nOfRank("5", 2), ...nOfRank("6", 2)])).toBe(false);
  });

  it("two consecutive pairs (4 cards) is not a valid tube", () => {
    expect(isValidTube([...nOfRank("3", 2), ...nOfRank("4", 2)])).toBe(false);
  });

  it("three consecutive triples (9 cards) is not a valid tube", () => {
    expect(isValidTube([...nOfRank("3", 3), ...nOfRank("4", 3), ...nOfRank("5", 3)])).toBe(false);
  });

  it("a pair + a plate is not a valid tube", () => {
    expect(isValidTube([...nOfRank("3", 2), ...nOfRank("4", 3), c("5", "SPADES")])).toBe(false);
  });

  it("two standard pairs + a joker pair is not a valid tube (jokers can't join a consecutive run)", () => {
    expect(isValidTube([...nOfRank("3", 2), ...nOfRank("4", 2), j("RED_JOKER"), j("RED_JOKER")])).toBe(
      false,
    );
  });
});

describe("isValidPlate", () => {
  it.each(straightStarts(2))("two consecutive triples starting at index %i is a valid plate", (start) => {
    expect(isValidPlate(plateFrom(start))).toBe(true);
  });

  it("two consecutive triples with a gap is not a valid plate", () => {
    expect(isValidPlate([...nOfRank("3", 3), ...nOfRank("5", 3)])).toBe(false);
  });

  it("a single triple (3 cards) is not a valid plate", () => {
    expect(isValidPlate(nOfRank("3", 3))).toBe(false);
  });

  it("three consecutive pairs (a tube) is not a valid plate", () => {
    expect(isValidPlate(tubeFrom(0))).toBe(false);
  });
});

describe("bomb identification", () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    it.each(STANDARD_RANK_ORDER)(`${n} %ss is a valid bomb`, (rank) => {
      expect(isValidBomb(nOfRank(rank, n))).toBe(true);
      expect(getComboType(nOfRank(rank, n))).toBe(`bomb_${n}`);
    });
  }

  it("all four jokers together is a joker bomb", () => {
    const cards = [j("RED_JOKER"), j("RED_JOKER"), j("BLACK_JOKER"), j("BLACK_JOKER")];
    expect(isJokerBomb(cards)).toBe(true);
    expect(isValidBomb(cards)).toBe(true);
    expect(getComboType(cards)).toBe("joker_bomb");
  });

  it("3 red + 1 black joker is not a joker bomb (impossible in a real deck, but shape-invalid regardless)", () => {
    expect(isJokerBomb([j("RED_JOKER"), j("RED_JOKER"), j("RED_JOKER"), j("BLACK_JOKER")])).toBe(false);
  });

  for (const length of [5, 6, 7, 8, 9, 10]) {
    it.each(straightStarts(length))(
      `a same-suit ${length}-run starting at index %i is a straight flush`,
      (start) => {
        const cards = straightFrom(start, length, "SPADES");
        expect(isStraightFlush(cards)).toBe(true);
        expect(isValidBomb(cards)).toBe(true);
        expect(getComboType(cards)).toBe("straight_flush");
      },
    );
  }

  it("mixed suits in a run is not a straight flush", () => {
    expect(isStraightFlush(straightFrom(0, 5))).toBe(false);
  });

  it("11 of a kind is not a recognized bomb", () => {
    expect(isValidBomb(nOfRank("5", 11))).toBe(false);
    expect(getComboType(nOfRank("5", 11))).toBeNull();
  });

  it("3 of a kind is not a bomb", () => {
    expect(isValidBomb(nOfRank("5", 3))).toBe(false);
  });
});

describe("BOMB_TYPE_ORDER", () => {
  it("matches the 9 documented bomb types in ascending strength order", () => {
    expect(BOMB_TYPE_ORDER).toEqual([
      "bomb_4",
      "bomb_5",
      "straight_flush",
      "bomb_6",
      "bomb_7",
      "bomb_8",
      "bomb_9",
      "bomb_10",
      "joker_bomb",
    ]);
  });

  it.each(BOMB_TYPE_ORDER)("%s is recognized as a bomb combo type", (type) => {
    expect(isBombComboType(type)).toBe(true);
  });

  it.each(["single", "pair", "triple", "full_house", "straight", "tube", "plate"] as const)(
    "%s is not a bomb combo type",
    (type) => {
      expect(isBombComboType(type)).toBe(false);
    },
  );
});

describe("getComboType", () => {
  it("returns null for an empty selection", () => {
    expect(getComboType([])).toBeNull();
  });

  it("returns null for an invalid shape", () => {
    expect(getComboType([c("3", "SPADES"), c("4", "CLUBS")])).toBeNull();
  });

  it.each(STANDARD_RANK_ORDER)("identifies a single %s", (rank) => {
    expect(getComboType([c(rank, "SPADES")])).toBe("single");
  });

  it.each(STANDARD_RANK_ORDER)("identifies a pair of %ss", (rank) => {
    expect(getComboType(nOfRank(rank, 2))).toBe("pair");
  });

  it.each(STANDARD_RANK_ORDER)("identifies a triple of %ss", (rank) => {
    expect(getComboType(nOfRank(rank, 3))).toBe("triple");
  });

  it("identifies a full house", () => {
    expect(getComboType([...nOfRank("3", 3), ...nOfRank("7", 2)])).toBe("full_house");
  });

  it("identifies a straight", () => {
    expect(getComboType(straightFrom(0, 5))).toBe("straight");
  });

  it("identifies a tube", () => {
    expect(getComboType(tubeFrom(0))).toBe("tube");
  });

  it("identifies a plate", () => {
    expect(getComboType(plateFrom(0))).toBe("plate");
  });
});

// getComboRank is null only for invalid combinations; every call below is
// against a shape already covered by the getComboType tests above, so this
// unwraps the null-ability rather than repeating a non-null assertion everywhere.
function rank(cards: Card[], levelRank: StandardRank): number {
  const result = getComboRank(cards, levelRank);
  expect(result).not.toBeNull();
  return result as number;
}

describe("getComboRank", () => {
  const LEVEL: StandardRank = "2"; // a level away from the ranks under test

  it("returns null for an invalid combination", () => {
    expect(getComboRank([c("3", "SPADES"), c("4", "CLUBS")], LEVEL)).toBeNull();
  });

  it.each(STANDARD_RANK_ORDER.slice(1, -1))("a higher single beats a lower single (%s < next)", (rankName) => {
    const nextRank = STANDARD_RANK_ORDER[STANDARD_RANK_ORDER.indexOf(rankName) + 1];
    const lower = rank([c(rankName, "SPADES")], LEVEL);
    const higher = rank([c(nextRank, "SPADES")], LEVEL);
    expect(higher).toBeGreaterThan(lower);
  });

  it("a higher pair beats a lower pair", () => {
    expect(rank(nOfRank("KING", 2), LEVEL)).toBeGreaterThan(rank(nOfRank("QUEEN", 2), LEVEL));
  });

  it("full house strength is driven by the triple, not the pair", () => {
    const higherTriple = rank([...nOfRank("KING", 3), ...nOfRank("2", 2)], LEVEL);
    const lowerTriple = rank([...nOfRank("QUEEN", 3), ...nOfRank("ACE", 2)], LEVEL);
    expect(higherTriple).toBeGreaterThan(lowerTriple);
  });

  it("a longer straight's strength is driven by its highest card", () => {
    const topsAtSeven = rank(straightFrom(STANDARD_RANK_ORDER.indexOf("3"), 5), LEVEL); // 3-4-5-6-7
    const topsAtEight = rank(straightFrom(STANDARD_RANK_ORDER.indexOf("4"), 5), LEVEL); // 4-5-6-7-8
    expect(topsAtEight).toBeGreaterThan(topsAtSeven);
  });

  it.each(STANDARD_RANK_ORDER)("any bomb outranks any ordinary combo (bomb_4 of %ss vs. an ace single)", (rankName) => {
    const bomb = rank(nOfRank(rankName, 4), LEVEL);
    const single = rank([c("ACE", "SPADES")], LEVEL);
    expect(bomb).toBeGreaterThan(single);
  });

  it("any bomb outranks the strongest ordinary combo (a plate)", () => {
    const bomb = rank(nOfRank("2", 4), LEVEL);
    const plate = rank(plateFrom(STANDARD_RANK_ORDER.indexOf("QUEEN")), LEVEL); // QUEEN-KING-ACE plate
    expect(bomb).toBeGreaterThan(plate);
  });

  it("bomb tiers follow BOMB_TYPE_ORDER regardless of rank", () => {
    for (let i = 1; i < BOMB_TYPE_ORDER.length; i++) {
      const lowerType = BOMB_TYPE_ORDER[i - 1];
      const higherType = BOMB_TYPE_ORDER[i];

      const lowerCards =
        lowerType === "joker_bomb"
          ? [j("RED_JOKER"), j("RED_JOKER"), j("BLACK_JOKER"), j("BLACK_JOKER")]
          : lowerType === "straight_flush"
            ? straightFrom(0, 5, "SPADES")
            : nOfRank("ACE", Number(lowerType.split("_")[1])); // highest possible rank, still loses on tier

      const higherCards =
        higherType === "joker_bomb"
          ? [j("RED_JOKER"), j("RED_JOKER"), j("BLACK_JOKER"), j("BLACK_JOKER")]
          : higherType === "straight_flush"
            ? straightFrom(0, 5, "SPADES")
            : nOfRank("2", Number(higherType.split("_")[1])); // lowest possible rank, still wins on tier

      expect(rank(higherCards, LEVEL)).toBeGreaterThan(rank(lowerCards, LEVEL));
    }
  });

  it("a level-rank card elevates a single above an ace", () => {
    const levelSingle = rank([c("5", "SPADES")], "5");
    const aceSingle = rank([c("ACE", "SPADES")], "5");
    expect(levelSingle).toBeGreaterThan(aceSingle);
  });

  it("a straight is NOT elevated by containing the level-rank card — the higher-topping straight always wins", () => {
    const level: StandardRank = "8";
    // 6-7-8-9-10: contains the level card (8) but tops out at 10.
    const containsLevelCard = rank(straightFrom(STANDARD_RANK_ORDER.indexOf("6"), 5), level);
    // 9-10-J-Q-K: no level card, but tops out higher, at KING.
    const topsHigherNoLevelCard = rank(straightFrom(STANDARD_RANK_ORDER.indexOf("9"), 5), level);
    expect(topsHigherNoLevelCard).toBeGreaterThan(containsLevelCard);
  });

  it("a tube is NOT elevated by containing the level-rank card", () => {
    const level: StandardRank = "5";
    const containsLevelCard = rank(tubeFrom(STANDARD_RANK_ORDER.indexOf("4")), level); // 4-5-6
    const topsHigherNoLevelCard = rank(tubeFrom(STANDARD_RANK_ORDER.indexOf("7")), level); // 7-8-9
    expect(topsHigherNoLevelCard).toBeGreaterThan(containsLevelCard);
  });
});
