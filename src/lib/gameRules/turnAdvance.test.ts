import type { CardWithWild, CurrentTrick, PlayerPosition, TrickEntry } from "../types";
import { PASS } from "../types";
import { advanceTrick, nextActivePosition } from "./turnAdvance";

const single = (rank: CardWithWild["rank"]): CardWithWild[] => [{ rank, suit: "SPADES" }];
const play = (position: PlayerPosition, rank: CardWithWild["rank"]): TrickEntry => ({
  position,
  play: single(rank),
});
const pass = (position: PlayerPosition): TrickEntry => ({ position, play: PASS });

describe("nextActivePosition", () => {
  it("returns the very next position when nobody is out", () => {
    expect(nextActivePosition(0, [])).toBe(1);
    expect(nextActivePosition(3, [])).toBe(0);
  });

  it("skips a single finished position", () => {
    expect(nextActivePosition(0, [1])).toBe(2);
  });

  it("skips multiple finished positions", () => {
    expect(nextActivePosition(0, [1, 2])).toBe(3);
  });

  it("wraps around the table while skipping", () => {
    expect(nextActivePosition(2, [3, 0])).toBe(1);
  });

  it("throws if there is no active position to hand the turn to", () => {
    expect(() => nextActivePosition(0, [1, 2, 3])).toThrow();
  });
});

describe("advanceTrick", () => {
  it("hands the turn to the next active position when the trick isn't complete", () => {
    const currentTrick: CurrentTrick = [play(0, "7")];
    const result = advanceTrick(currentTrick, play(1, "8"), [], 0, 2);
    expect(result).toEqual({
      currentTrick: [play(0, "7"), play(1, "8")],
      trickCount: 2,
      leaderPosition: 0,
      currentPlayerTurn: 2,
    });
  });

  it("skips finished positions when handing off turn mid-trick", () => {
    const currentTrick: CurrentTrick = [play(0, "7")];
    const result = advanceTrick(currentTrick, play(1, "8"), [2], 0, 0);
    expect(result.currentPlayerTurn).toBe(3);
  });

  it("resolves the trick once every active (4/4) position has acted", () => {
    const currentTrick: CurrentTrick = [play(0, "7"), pass(1), play(2, "9")];
    const result = advanceTrick(currentTrick, play(3, "10"), [], 0, 2);
    expect(result).toEqual({
      currentTrick: [],
      trickCount: 3,
      leaderPosition: 3,
      currentPlayerTurn: 3,
    });
  });

  it("resolves a trick with fewer than 4 entries once every remaining active position has acted", () => {
    // Positions 1 and 2 are already out; only 0 and 3 are active.
    const currentTrick: CurrentTrick = [play(0, "7")];
    const result = advanceTrick(currentTrick, pass(3), [1, 2], 0, 5);
    expect(result).toEqual({
      currentTrick: [],
      trickCount: 6,
      leaderPosition: 0,
      currentPlayerTurn: 0,
    });
  });

  it("hands the lead to the winner's partner when the winning play emptied their hand", () => {
    const currentTrick: CurrentTrick = [play(0, "7"), pass(1), play(2, "9")];
    // Position 3 wins with their last card — finishOrder already reflects it.
    const result = advanceTrick(currentTrick, play(3, "10"), [3], 0, 2);
    // Position 3's partner (team B) is position 1.
    expect(result.leaderPosition).toBe(1);
    expect(result.currentPlayerTurn).toBe(1);
    expect(result.currentTrick).toEqual([]);
  });

  it("hands the lead to the winner themselves when they still have cards", () => {
    const currentTrick: CurrentTrick = [play(0, "7"), pass(1), play(2, "9")];
    const result = advanceTrick(currentTrick, play(3, "10"), [], 0, 2);
    expect(result.leaderPosition).toBe(3);
  });

  it("credits the winner correctly even when they went out earlier in the same trick", () => {
    // Position 0 led with a play that emptied their hand; everyone else passes.
    const currentTrick: CurrentTrick = [play(0, "7"), pass(1), pass(2)];
    const result = advanceTrick(currentTrick, pass(3), [0], 0, 4);
    // Position 0 (team A) won by default (last non-PASS), but has no cards —
    // their partner (position 2) leads next.
    expect(result.leaderPosition).toBe(2);
    expect(result.currentPlayerTurn).toBe(2);
  });
});
