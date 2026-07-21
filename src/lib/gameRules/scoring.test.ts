import type { CardWithWild, CurrentTrick, PlayerPosition, TrickPlay } from "../types";
import { PASS } from "../types";
import {
  ACE_LEVEL,
  STARTING_LEVEL,
  calculateLevelPromotion,
  calculateTrickWinner,
  detectRoundEnd,
  getFinishResult,
} from "./scoring";

// A play doesn't need to be a real combination for these tests -- scoring
// only cares whether an entry is PASS or not, never what was played.
function play(): TrickPlay {
  return [{ rank: "3", suit: "CLUBS" }] as CardWithWild[];
}

const POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([item, ...perm]);
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// calculateTrickWinner
// ---------------------------------------------------------------------------

describe("calculateTrickWinner", () => {
  // Trick shapes as relative offsets from the leader: entries are either a
  // play or PASS. The expected winner is the position of the last play.
  const shapes: { name: string; entries: TrickPlay[]; winnerOffset: number }[] = [
    { name: "leader plays alone (trick still open)", entries: [play()], winnerOffset: 0 },
    { name: "everyone passes the leader's play", entries: [play(), PASS, PASS, PASS], winnerOffset: 0 },
    { name: "2nd player beats the lead, rest pass", entries: [play(), play(), PASS, PASS], winnerOffset: 1 },
    { name: "3rd player beats, 2nd passed", entries: [play(), PASS, play(), PASS], winnerOffset: 2 },
    { name: "4th player beats, middle two passed", entries: [play(), PASS, PASS, play()], winnerOffset: 3 },
    { name: "3rd beats then 4th passes", entries: [play(), play(), play(), PASS], winnerOffset: 2 },
    { name: "all four play, last one wins", entries: [play(), play(), play(), play()], winnerOffset: 3 },
  ];

  for (const leaderPosition of POSITIONS) {
    for (const shape of shapes) {
      it(`leader at ${leaderPosition}: ${shape.name}`, () => {
        const currentTrick: CurrentTrick = shape.entries;
        const expected = ((leaderPosition + shape.winnerOffset) % 4) as PlayerPosition;
        expect(calculateTrickWinner(currentTrick, leaderPosition)).toBe(expected);
      });
    }
  }

  it("throws when the trick has no entries at all", () => {
    expect(() => calculateTrickWinner([], 0)).toThrow();
  });

  it("throws when every entry is somehow a pass (leader must always open with a play)", () => {
    expect(() => calculateTrickWinner([PASS, PASS, PASS], 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// detectRoundEnd
// ---------------------------------------------------------------------------

describe("detectRoundEnd", () => {
  it("returns null when nobody has finished yet", () => {
    expect(detectRoundEnd([])).toBeNull();
  });

  it("throws on a duplicate position in finishOrder", () => {
    expect(() => detectRoundEnd([0, 1, 0])).toThrow();
  });

  it("throws on an out-of-range position in finishOrder", () => {
    expect(() => detectRoundEnd([0, 1, 5 as PlayerPosition])).toThrow();
  });

  describe("fewer than 3 finishers: round continues (null)", () => {
    for (const position of POSITIONS) {
      it(`only position ${position} has finished`, () => {
        expect(detectRoundEnd([position])).toBeNull();
      });
    }

    // permutations(POSITIONS).map(p => p.slice(0, 2)) would produce every
    // ordered pair twice (once per irrelevant ordering of the other two
    // positions), so dedupe by the pair's own identity first.
    const seenPairs = new Set<string>();
    for (const pair of permutations(POSITIONS).map((p) => p.slice(0, 2))) {
      const key = pair.join(",");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      it(`positions ${key} have finished, in that order`, () => {
        expect(detectRoundEnd(pair)).toBeNull();
      });
    }
  });

  describe("exactly 3 finishers: 4th is auto-placed last", () => {
    for (const perm of permutations(POSITIONS)) {
      const finishOrder = perm.slice(0, 3);
      const remaining = perm[3];
      it(`finish order ${finishOrder.join(",")} places ${remaining} 4th`, () => {
        const result = detectRoundEnd(finishOrder);
        expect(result).not.toBeNull();
        const expected = new Array<number>(4).fill(0);
        finishOrder.forEach((pos, i) => (expected[pos] = i + 1));
        expected[remaining] = 4;
        expect(result).toEqual(expected);
      });
    }
  });

  describe("all 4 finishers given explicitly", () => {
    for (const perm of permutations(POSITIONS)) {
      it(`finish order ${perm.join(",")}`, () => {
        const result = detectRoundEnd(perm);
        const expected = new Array<number>(4).fill(0);
        perm.forEach((pos, i) => (expected[pos] = i + 1));
        expect(result).toEqual(expected);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// getFinishResult & calculateLevelPromotion
// ---------------------------------------------------------------------------

describe("getFinishResult", () => {
  for (const perm of permutations(POSITIONS)) {
    const finishingPositions = detectRoundEnd(perm)!;
    const winnerPosition = perm[0];
    const winningTeam = (winnerPosition % 2) as 0 | 1;
    const partnerPosition = ((winnerPosition + 2) % 4) as PlayerPosition;
    const partnerRank = finishingPositions[partnerPosition];
    const expectedCombo = partnerRank === 2 ? "1-2" : partnerRank === 3 ? "1-3" : "1-4";

    it(`finish order ${perm.join(",")} -> team ${winningTeam}, ${expectedCombo}`, () => {
      expect(getFinishResult(finishingPositions)).toEqual({
        winningTeam,
        combo: expectedCombo,
      });
    });
  }

  it("1-2 finish: partner of 1st place also finished 2nd", () => {
    // positions 0 & 2 are a team; 0 finishes 1st, 2 finishes 2nd.
    expect(getFinishResult([1, 3, 2, 4])).toEqual({ winningTeam: 0, combo: "1-2" });
  });

  it("1-3 finish: partner of 1st place finished 3rd", () => {
    expect(getFinishResult([1, 2, 3, 4])).toEqual({ winningTeam: 0, combo: "1-3" });
  });

  it("1-4 finish: partner of 1st place finished last", () => {
    expect(getFinishResult([1, 2, 4, 3])).toEqual({ winningTeam: 0, combo: "1-4" });
  });

  it("team B can also be the winning team", () => {
    // position 1 finishes 1st, partner position 3 finishes 2nd -> 1-2.
    expect(getFinishResult([4, 1, 3, 2])).toEqual({ winningTeam: 1, combo: "1-2" });
  });
});

describe("calculateLevelPromotion", () => {
  it("1-2 finish promotes the winning team by 4 levels", () => {
    expect(calculateLevelPromotion([1, 3, 2, 4], [STARTING_LEVEL, STARTING_LEVEL])).toEqual([6, 2]);
  });

  it("1-3 finish promotes the winning team by 2 levels", () => {
    expect(calculateLevelPromotion([1, 2, 3, 4], [STARTING_LEVEL, STARTING_LEVEL])).toEqual([4, 2]);
  });

  it("1-4 finish promotes the winning team by 1 level", () => {
    expect(calculateLevelPromotion([1, 2, 4, 3], [STARTING_LEVEL, STARTING_LEVEL])).toEqual([3, 2]);
  });

  it("team B winning promotes teamBLevel, leaves teamALevel untouched", () => {
    // position 1 finishes 1st, partner position 3 finishes 2nd -> 1-2, +4 levels.
    expect(calculateLevelPromotion([4, 1, 3, 2], [5, 5])).toEqual([5, 9]);
  });

  it("does not touch the losing team's level even on a 1-2 finish", () => {
    expect(calculateLevelPromotion([1, 3, 2, 4], [2, 10])).toEqual([6, 10]);
  });

  it("caps promotion at Ace (level 14) on a 1-2 finish from level 12", () => {
    expect(calculateLevelPromotion([1, 3, 2, 4], [12, 2])).toEqual([ACE_LEVEL, 2]);
  });

  it("caps promotion at Ace on a 1-3 finish from level 13", () => {
    expect(calculateLevelPromotion([1, 2, 3, 4], [13, 2])).toEqual([ACE_LEVEL, 2]);
  });

  it("caps promotion at Ace on a 1-4 finish already at Ace", () => {
    expect(calculateLevelPromotion([1, 2, 4, 3], [ACE_LEVEL, 2])).toEqual([ACE_LEVEL, 2]);
  });

  it("a team already at Ace with a 1-2 finish stays at Ace (win is decided elsewhere)", () => {
    expect(calculateLevelPromotion([1, 3, 2, 4], [ACE_LEVEL, 2])).toEqual([ACE_LEVEL, 2]);
  });

  for (const perm of permutations(POSITIONS)) {
    const finishingPositions = detectRoundEnd(perm)!;
    const { winningTeam, combo } = getFinishResult(finishingPositions);
    const delta = combo === "1-2" ? 4 : combo === "1-3" ? 2 : 1;

    it(`finish order ${perm.join(",")}: winning team ${winningTeam} gains ${delta} level(s)`, () => {
      const currentLevels: [number, number] = [STARTING_LEVEL, STARTING_LEVEL];
      const result = calculateLevelPromotion(finishingPositions, currentLevels);
      const expected: [number, number] = [...currentLevels];
      expected[winningTeam] = Math.min(currentLevels[winningTeam] + delta, ACE_LEVEL);
      expect(result).toEqual(expected);
    });
  }
});
