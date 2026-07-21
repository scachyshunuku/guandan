import type { CardWithWild, CurrentTrick, PlayerPosition } from "../types";
import { PASS } from "../types";
import { advanceTrick, calculateTrickWinner } from "./scoring";

const single = (rank: CardWithWild["rank"]): CardWithWild[] => [{ rank, suit: "SPADES" }];

describe("calculateTrickWinner", () => {
  it("returns the leader when everyone else passes", () => {
    const trick: CurrentTrick = [single("7"), PASS, PASS, PASS];
    expect(calculateTrickWinner(trick, 0)).toBe(0);
  });

  it("returns the position of the last non-PASS entry", () => {
    const trick: CurrentTrick = [single("7"), single("8"), PASS, single("9")];
    // leader is position 1, so entries map to positions 1, 2, 3, 0
    expect(calculateTrickWinner(trick, 1)).toBe(0);
  });

  it("wraps position math around the table", () => {
    const trick: CurrentTrick = [single("7"), single("8"), PASS, PASS];
    // leader is position 2: entries map to 2, 3, 0, 1 -> winner is entry index 1 -> position 3
    expect(calculateTrickWinner(trick, 2 as PlayerPosition)).toBe(3);
  });

  it("resolves mid-trick (fewer than 4 entries) against the last play so far", () => {
    const trick: CurrentTrick = [single("7"), PASS];
    expect(calculateTrickWinner(trick, 3 as PlayerPosition)).toBe(3);
  });

  it("throws if the trick has no plays at all", () => {
    expect(() => calculateTrickWinner([], 0)).toThrow();
  });
});

describe("advanceTrick", () => {
  it("hands the turn to the next position when the trick isn't complete", () => {
    const result = advanceTrick([single("7")], single("8"), 0, 1, 2);
    expect(result).toEqual({
      gameState: { currentTrick: [single("7"), single("8")], trickCount: 2 },
      leaderPosition: 0,
      currentPlayerTurn: 2,
    });
  });

  it("wraps the next-position math from 3 back to 0", () => {
    const result = advanceTrick([single("7"), single("8")], PASS, 0, 3, 0);
    expect(result.currentPlayerTurn).toBe(0);
  });

  it("resolves the trick once the 4th entry completes the rotation", () => {
    const result = advanceTrick(
      [single("7"), PASS, single("9")],
      single("10"),
      0,
      3,
      2,
    );
    expect(result).toEqual({
      gameState: { currentTrick: [], trickCount: 3 },
      leaderPosition: 3,
      currentPlayerTurn: 3,
    });
  });

  it("resolves a trick where every response passes back to the leader", () => {
    const result = advanceTrick([single("7"), PASS, PASS], PASS, 0, 3, 5);
    expect(result).toEqual({
      gameState: { currentTrick: [], trickCount: 6 },
      leaderPosition: 0,
      currentPlayerTurn: 0,
    });
  });
});
