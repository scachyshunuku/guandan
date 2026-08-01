import { chooseTrickAction } from "./chooseTrickAction";
import type { CardWithWild, CurrentTrick } from "@/lib/types";

describe("chooseTrickAction", () => {
  it("leads the lowest single in hand", () => {
    const hand: CardWithWild[] = [
      { rank: "9", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
      { rank: "KING", suit: "SPADES" },
    ];
    const decision = chooseTrickAction(hand, [], "2");
    expect(decision).toEqual({ action: "play", cards: [{ rank: "3", suit: "HEARTS" }] });
  });

  it("follows with the lowest single that legally beats the trick", () => {
    const hand: CardWithWild[] = [
      { rank: "5", suit: "CLUBS" },
      { rank: "9", suit: "DIAMONDS" },
    ];
    const currentTrick: CurrentTrick = [{ position: 0, play: [{ rank: "7", suit: "CLUBS" }] }];
    const decision = chooseTrickAction(hand, currentTrick, "2");
    expect(decision).toEqual({ action: "play", cards: [{ rank: "9", suit: "DIAMONDS" }] });
  });

  it("passes when nothing in hand beats the trick", () => {
    const hand: CardWithWild[] = [{ rank: "3", suit: "CLUBS" }];
    const currentTrick: CurrentTrick = [{ position: 0, play: [{ rank: "9", suit: "CLUBS" }] }];
    const decision = chooseTrickAction(hand, currentTrick, "2");
    expect(decision).toEqual({ action: "pass" });
  });

  it("never claims a wild-card substitution, even with a level-rank heart in hand", () => {
    const hand: CardWithWild[] = [{ rank: "2", suit: "HEARTS" }];
    const decision = chooseTrickAction(hand, [], "2");
    expect(decision.action).toBe("play");
    if (decision.action === "play") {
      expect(decision.cards[0].actsAs).toBeUndefined();
    }
  });
});
