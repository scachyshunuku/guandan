import type { CardWithWild, StandardRank } from "../types";
import { computeExchangeHandWrites, planInitialExchanges, type ParticipantHands } from "./cardExchange";

function participant(position: 0 | 1 | 2 | 3, hand: CardWithWild[]): ParticipantHands {
  return { position, hand };
}

describe("planInitialExchanges: single-team lead (1-3/1-4)", () => {
  const levelRank: StandardRank = "2";

  it("sends 4th's best card to 1st, no other transfer", () => {
    const participants = [
      participant(0, []),
      participant(1, []),
      participant(2, []),
      participant(3, [
        { rank: "9", suit: "CLUBS" },
        { rank: "KING", suit: "SPADES" },
      ]),
    ];
    // finishingPositions: [1, 2, 3, 4] -> position 0 is 1st, position 3 is 4th
    const plan = planInitialExchanges("1-3", [1, 2, 3, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsChoice: false,
      transfers: [{ from: 3, to: 0, card: { rank: "KING", suit: "SPADES" } }],
    });
  });

  it("cancels the tribute when 4th alone holds both Red Jokers", () => {
    const participants = [
      participant(0, []),
      participant(1, []),
      participant(2, []),
      participant(3, [{ rank: "RED_JOKER" }, { rank: "RED_JOKER" }]),
    ];
    const plan = planInitialExchanges("1-4", [1, 2, 3, 4], participants, levelRank);
    expect(plan).toEqual({ cancelled: true, needsChoice: false, transfers: [] });
  });
});

describe("planInitialExchanges: two-team lead (1-2)", () => {
  const levelRank: StandardRank = "2";

  it("sends the higher-rank card to 1st and the lower to 2nd", () => {
    const participants = [
      participant(0, []),
      participant(1, [{ rank: "9", suit: "CLUBS" }]),
      participant(2, []),
      participant(3, [{ rank: "QUEEN", suit: "SPADES" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsChoice: false,
      transfers: [
        { from: 1, to: 2, card: { rank: "9", suit: "CLUBS" } },
        { from: 3, to: 0, card: { rank: "QUEEN", suit: "SPADES" } },
      ],
    });
  });

  it("cancels the tribute when 3rd and 4th hold both Red Jokers between them (split)", () => {
    const participants = [
      participant(0, []),
      participant(1, [{ rank: "RED_JOKER" }]),
      participant(2, []),
      participant(3, [{ rank: "RED_JOKER" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank);
    expect(plan).toEqual({ cancelled: true, needsChoice: false, transfers: [] });
  });

  it("surfaces needsChoice, with both tied cards, when 3rd and 4th's best cards tie in rank", () => {
    const participants = [
      participant(0, []),
      participant(1, [{ rank: "9", suit: "CLUBS" }]),
      participant(2, []),
      participant(3, [{ rank: "9", suit: "SPADES" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsChoice: true,
      thirdPosition: 1,
      thirdCard: { rank: "9", suit: "CLUBS" },
      fourthPosition: 3,
      fourthCard: { rank: "9", suit: "SPADES" },
    });
  });

  it("a tie between level-rank hearts and another suit still resolves via hearts' wild-card priority (RULES.md), not needsChoice", () => {
    // Level is "9": among 9s specifically, hearts outranks the other three
    // suits (RULES.md "Level Cards & Wild Cards") — so this isn't a genuine
    // tie despite both cards sharing a rank.
    const levelRankNine: StandardRank = "9";
    const participants = [
      participant(0, []),
      participant(1, [{ rank: "9", suit: "HEARTS" }]),
      participant(2, []),
      participant(3, [{ rank: "9", suit: "SPADES" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRankNine);
    expect(plan).toEqual({
      cancelled: false,
      needsChoice: false,
      transfers: [
        { from: 1, to: 0, card: { rank: "9", suit: "HEARTS" } },
        { from: 3, to: 2, card: { rank: "9", suit: "SPADES" } },
      ],
    });
  });
});

describe("computeExchangeHandWrites", () => {
  it("removes each transfer's card from the giver's hand and appends it to the recipient's", () => {
    const participants = [
      participant(0, [{ rank: "3", suit: "CLUBS" }]),
      participant(1, [{ rank: "9", suit: "CLUBS" }, { rank: "3", suit: "DIAMONDS" }]),
      participant(2, []),
      participant(3, [{ rank: "QUEEN", suit: "SPADES" }]),
    ];
    const writes = computeExchangeHandWrites(participants, [
      { from: 3, to: 0, card: { rank: "QUEEN", suit: "SPADES" } },
      { from: 1, to: 2, card: { rank: "9", suit: "CLUBS" } },
    ]);
    expect(writes).toEqual(
      expect.arrayContaining([
        { position: 3, newHand: [] },
        { position: 0, newHand: [{ rank: "3", suit: "CLUBS" }, { rank: "QUEEN", suit: "SPADES" }] },
        { position: 1, newHand: [{ rank: "3", suit: "DIAMONDS" }] },
        { position: 2, newHand: [{ rank: "9", suit: "CLUBS" }] },
      ]),
    );
  });
});
