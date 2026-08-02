import type { CardWithWild, PlayerPosition, StandardRank } from "../types";
import {
  computeExchangeHandWrites,
  leaderPositionForTransfers,
  planInitialExchanges,
  type ParticipantHands,
} from "./cardExchange";

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
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [{ from: 3, to: 0, card: { rank: "KING", suit: "SPADES" } }],
    });
  });

  it("exempts a level-rank heart from tribute and sends the best eligible card instead", () => {
    const participants = [
      participant(0, []),
      participant(1, []),
      participant(2, []),
      participant(3, [
        { rank: "9", suit: "HEARTS" },
        { rank: "ACE", suit: "SPADES" },
      ]),
    ];
    const plan = planInitialExchanges("1-3", [1, 2, 3, 4], participants, "9");
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [{ from: 3, to: 0, card: { rank: "ACE", suit: "SPADES" } }],
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
    expect(plan).toEqual({ cancelled: true, needsGiverChoice: false, needsChoice: false, transfers: [] });
  });

  it("does not cancel a 1-4 finish when the Red Jokers are split one each between 1st and 4th (teammates)", () => {
    // RULES.md "Single-Team Lead": cancellation is keyed on 4th place's own
    // hand alone, not the team as a whole - even though 1st and 4th are
    // partners in a 1-4 finish, 1st holding the other joker doesn't count.
    const participants = [
      participant(0, [{ rank: "RED_JOKER" }]),
      participant(1, []),
      participant(2, []),
      participant(3, [{ rank: "RED_JOKER" }, { rank: "9", suit: "CLUBS" }]),
    ];
    const plan = planInitialExchanges("1-4", [1, 2, 3, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      // 4th's best card is their own Red Joker (outranks the 9), still sent to 1st.
      transfers: [{ from: 3, to: 0, card: { rank: "RED_JOKER" } }],
    });
  });

  it("surfaces needsGiverChoice, with every tied candidate, when 4th's hand has more than one card tied for best", () => {
    // RULES.md "Best card, when tied": a double deck can give 4th place two
    // physical cards of the same top rank (here, two Kings) - they choose
    // which one to give rather than it being picked for them.
    const participants = [
      participant(0, []),
      participant(1, []),
      participant(2, []),
      participant(3, [
        { rank: "9", suit: "CLUBS" },
        { rank: "KING", suit: "SPADES" },
        { rank: "KING", suit: "HEARTS" },
      ]),
    ];
    const plan = planInitialExchanges("1-4", [1, 2, 3, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: true,
      needsChoice: false,
      givers: [
        {
          position: 3,
          candidates: expect.arrayContaining([
            { rank: "KING", suit: "SPADES" },
            { rank: "KING", suit: "HEARTS" },
          ]),
        },
      ],
    });
  });

  it("does not need a giver choice once resolvedGiverCards already has 4th's pick", () => {
    const participants = [
      participant(0, []),
      participant(1, []),
      participant(2, []),
      participant(3, [
        { rank: "KING", suit: "SPADES" },
        { rank: "KING", suit: "HEARTS" },
      ]),
    ];
    const plan = planInitialExchanges("1-4", [1, 2, 3, 4], participants, levelRank, {
      3: { rank: "KING", suit: "HEARTS" },
    });
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [{ from: 3, to: 0, card: { rank: "KING", suit: "HEARTS" } }],
    });
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
      needsGiverChoice: false,
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
    expect(plan).toEqual({ cancelled: true, needsGiverChoice: false, needsChoice: false, transfers: [] });
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
      needsGiverChoice: false,
      needsChoice: true,
      thirdPosition: 1,
      thirdCard: { rank: "9", suit: "CLUBS" },
      fourthPosition: 3,
      fourthCard: { rank: "9", suit: "SPADES" },
    });
  });

  it("exempts a level-rank heart from tribute before comparing the two givers", () => {
    // Level is "9": the 9 of hearts is normally the best level card, but
    // wild level hearts can never be tribute. 3rd therefore gives their Ace,
    // not the 9 of hearts, and it beats 4th's King.
    const levelRankNine: StandardRank = "9";
    const participants = [
      participant(0, []),
      participant(1, [
        { rank: "9", suit: "HEARTS" },
        { rank: "ACE", suit: "CLUBS" },
      ]),
      participant(2, []),
      participant(3, [{ rank: "KING", suit: "SPADES" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRankNine);
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [
        { from: 1, to: 0, card: { rank: "ACE", suit: "CLUBS" } },
        { from: 3, to: 2, card: { rank: "KING", suit: "SPADES" } },
      ],
    });
  });

  it("surfaces a giver choice for whichever of 3rd/4th has a tied hand, before any cross-giver comparison", () => {
    // 3rd's hand has two tied Queens; 4th's hand has a unique 9. Only 3rd
    // owes a choice - the cross-giver tie-break (needsChoice) can't even be
    // evaluated yet since 3rd's actual contribution isn't known.
    const participants = [
      participant(0, []),
      participant(1, [
        { rank: "QUEEN", suit: "SPADES" },
        { rank: "QUEEN", suit: "HEARTS" },
      ]),
      participant(2, []),
      participant(3, [{ rank: "9", suit: "CLUBS" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank);
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: true,
      needsChoice: false,
      givers: [
        {
          position: 1,
          candidates: expect.arrayContaining([
            { rank: "QUEEN", suit: "SPADES" },
            { rank: "QUEEN", suit: "HEARTS" },
          ]),
        },
      ],
    });
  });

  it("surfaces both givers' choices at once when both 3rd and 4th have tied hands", () => {
    const participants = [
      participant(0, []),
      participant(1, [
        { rank: "QUEEN", suit: "SPADES" },
        { rank: "QUEEN", suit: "HEARTS" },
      ]),
      participant(2, []),
      participant(3, [
        { rank: "9", suit: "CLUBS" },
        { rank: "9", suit: "DIAMONDS" },
      ]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank);
    expect(plan.needsGiverChoice).toBe(true);
    if (!plan.needsGiverChoice) throw new Error("expected needsGiverChoice");
    expect(plan.givers.map((g: { position: PlayerPosition }) => g.position).sort()).toEqual([1, 3]);
  });

  it("once both givers' choices are resolved, proceeds to the cross-giver comparison", () => {
    const participants = [
      participant(0, []),
      participant(1, [
        { rank: "QUEEN", suit: "SPADES" },
        { rank: "QUEEN", suit: "HEARTS" },
      ]),
      participant(2, []),
      participant(3, [{ rank: "9", suit: "CLUBS" }]),
    ];
    const plan = planInitialExchanges("1-2", [1, 3, 2, 4], participants, levelRank, {
      1: { rank: "QUEEN", suit: "HEARTS" },
    });
    expect(plan).toEqual({
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [
        { from: 1, to: 0, card: { rank: "QUEEN", suit: "HEARTS" } },
        { from: 3, to: 2, card: { rank: "9", suit: "CLUBS" } },
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

describe("leaderPositionForTransfers", () => {
  it("returns whoever gave the card routed to 1st place, not 1st place itself (RULES.md 'Leader Selection')", () => {
    const transfers = [
      { from: 3 as PlayerPosition, to: 0 as PlayerPosition, card: { rank: "QUEEN", suit: "SPADES" } as CardWithWild },
      { from: 1 as PlayerPosition, to: 2 as PlayerPosition, card: { rank: "9", suit: "CLUBS" } as CardWithWild },
    ];
    expect(leaderPositionForTransfers(transfers, 0)).toBe(3);
  });

  it("works for a single-team lead's lone transfer too", () => {
    const transfers = [
      { from: 2 as PlayerPosition, to: 0 as PlayerPosition, card: { rank: "KING", suit: "CLUBS" } as CardWithWild },
    ];
    expect(leaderPositionForTransfers(transfers, 0)).toBe(2);
  });
});
