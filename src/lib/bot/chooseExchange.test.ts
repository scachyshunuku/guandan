import { pickExchangeReturnCard, pickGiverCard, pickTributeTake } from "./chooseExchange";
import type { CardWithWild } from "@/lib/types";

describe("chooseExchange", () => {
  it("pickGiverCard picks the first tied candidate", () => {
    const candidates = [{ rank: "ACE", suit: "SPADES" } as const, { rank: "ACE", suit: "CLUBS" } as const];
    expect(pickGiverCard(candidates)).toBe(candidates[0]);
  });

  it("pickTributeTake takes the third-place position", () => {
    expect(pickTributeTake(2)).toBe(2);
  });

  it("pickExchangeReturnCard returns the lowest card in hand", () => {
    const hand: CardWithWild[] = [
      { rank: "9", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
      { rank: "KING", suit: "SPADES" },
    ];
    expect(pickExchangeReturnCard(hand, "2")).toEqual({ rank: "3", suit: "HEARTS" });
  });
});
