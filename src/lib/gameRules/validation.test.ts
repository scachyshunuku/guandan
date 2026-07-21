import type { CardWithWild, CurrentTrick, PlayerPosition, StandardRank, Suit, TrickPlay } from "../types";
import { PASS } from "../types";
import { STANDARD_RANK_ORDER, SUIT_ORDER } from "../cardUtils";
import { beatsTrick, canPlayCards, resolveCard, resolveCards } from "./validation";

function c(rank: StandardRank, suit: Suit): CardWithWild {
  return { rank, suit };
}

function j(rank: "BLACK_JOKER" | "RED_JOKER"): CardWithWild {
  return { rank };
}

// n cards of the same standard rank, cycling suits — duplicate suits are
// fine, representing the second deck.
function nOfRank(rank: StandardRank, n: number): CardWithWild[] {
  return Array.from({ length: n }, (_, i) => c(rank, SUIT_ORDER[i % SUIT_ORDER.length]));
}

function straightFrom(startIndex: number, length = 5): CardWithWild[] {
  return STANDARD_RANK_ORDER.slice(startIndex, startIndex + length).map((rank, i) => ({
    rank,
    suit: SUIT_ORDER[i % SUIT_ORDER.length],
  }));
}

// A level rank guaranteed not to appear among `ranks`, so a test can use
// plain (non-wild, non-elevated) cards.
function levelRankExcluding(...ranks: StandardRank[]): StandardRank {
  return STANDARD_RANK_ORDER.find((r) => !ranks.includes(r))!;
}

// A single-entry trick: just a lead, nothing beating it yet. Position is
// arbitrary (position 0) since beatsTrick/canPlayCards never look at it.
function lead(play: TrickPlay): CurrentTrick {
  return [{ position: 0, play }];
}

const NO_LEAD: CurrentTrick = [];

describe("resolveCard / resolveCards", () => {
  it("a plain card resolves to itself", () => {
    expect(resolveCard(c("7", "CLUBS"))).toEqual({ rank: "7", suit: "CLUBS" });
  });

  it("a joker resolves to itself", () => {
    expect(resolveCard(j("RED_JOKER"))).toEqual({ rank: "RED_JOKER" });
  });

  it("a wild card resolves to what it acts as", () => {
    const wild: CardWithWild = { rank: "5", suit: "HEARTS", actsAs: { rank: "ACE", suit: "SPADES" } };
    expect(resolveCard(wild)).toEqual({ rank: "ACE", suit: "SPADES" });
  });

  it("resolves a list of mixed plain and wild cards", () => {
    const wild: CardWithWild = { rank: "5", suit: "HEARTS", actsAs: { rank: "3", suit: "DIAMONDS" } };
    const resolved = resolveCards([c("9", "CLUBS"), wild]);
    expect(resolved).toEqual([
      { rank: "9", suit: "CLUBS" },
      { rank: "3", suit: "DIAMONDS" },
    ]);
  });
});

describe("canPlayCards: ownership", () => {
  const levelRank = levelRankExcluding("7", "8");

  it("allows playing a card that's in hand", () => {
    const hand = [c("7", "CLUBS"), c("8", "SPADES")];
    expect(canPlayCards([c("7", "CLUBS")], hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });

  it("rejects playing a card not in hand", () => {
    const hand = [c("8", "SPADES")];
    const result = canPlayCards([c("7", "CLUBS")], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in hand/);
  });

  it("rejects playing a card with the right rank but wrong suit", () => {
    const hand = [c("7", "SPADES")];
    const result = canPlayCards([c("7", "CLUBS")], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
  });

  it("allows playing both copies of a duplicate card from the double deck", () => {
    const hand = [c("7", "CLUBS"), c("7", "CLUBS")];
    expect(canPlayCards([c("7", "CLUBS"), c("7", "CLUBS")], hand, NO_LEAD, levelRank)).toEqual({
      valid: true,
    });
  });

  it("rejects playing a duplicate card the hand only holds once", () => {
    const hand = [c("7", "CLUBS"), c("8", "SPADES")];
    const result = canPlayCards([c("7", "CLUBS"), c("7", "CLUBS")], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in hand/);
  });

  it("rejects playing more cards of a rank than held, even mixed with other valid cards", () => {
    const hand = [c("7", "CLUBS"), c("7", "SPADES"), c("8", "SPADES")];
    // Trying to play three 7s when only two are held.
    const result = canPlayCards(
      [c("7", "CLUBS"), c("7", "SPADES"), c("7", "SPADES")],
      hand,
      NO_LEAD,
      levelRank,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed played card instead of throwing", () => {
    const malformed = { rank: "7" } as CardWithWild; // standard rank missing its suit
    const hand = [malformed];
    expect(() => canPlayCards([malformed], hand, NO_LEAD, levelRank)).not.toThrow();
    const result = canPlayCards([malformed], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/malformed/);
  });
});

describe("canPlayCards: wild card legality", () => {
  it("allows the level-rank heart to be played wild", () => {
    const levelRank: StandardRank = "5";
    const wild: CardWithWild = { rank: "5", suit: "HEARTS", actsAs: { rank: "ACE", suit: "SPADES" } };
    const hand = [wild];
    expect(canPlayCards([wild], hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });

  it("rejects a non-level-rank heart claiming to be wild", () => {
    const levelRank: StandardRank = "5";
    const notWild: CardWithWild = { rank: "6", suit: "HEARTS", actsAs: { rank: "ACE", suit: "SPADES" } };
    const hand = [notWild];
    const result = canPlayCards([notWild], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/wild/);
  });

  it("rejects a level-rank non-heart claiming to be wild", () => {
    const levelRank: StandardRank = "5";
    const notWild: CardWithWild = { rank: "5", suit: "SPADES", actsAs: { rank: "ACE", suit: "SPADES" } };
    const hand = [notWild];
    const result = canPlayCards([notWild], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/wild/);
  });

  it("a wild card can complete a combination it wouldn't otherwise form", () => {
    const levelRank: StandardRank = "5";
    const wild: CardWithWild = { rank: "5", suit: "HEARTS", actsAs: { rank: "9", suit: "SPADES" } };
    const hand = [c("9", "CLUBS"), wild];
    // 9-9 pair, one of them the wild heart standing in as the 9 of spades.
    expect(canPlayCards([c("9", "CLUBS"), wild], hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });
});

describe("canPlayCards / beatsTrick: leading an empty trick", () => {
  const levelRank = levelRankExcluding("7", "8", "9");

  it("any valid ordinary combination can lead", () => {
    const hand = nOfRank("7", 2);
    expect(canPlayCards(hand, hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });

  it("a bomb can lead (RULES.md: leader may play a bomb)", () => {
    const hand = nOfRank("7", 4);
    expect(canPlayCards(hand, hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });

  it("an invalid shape cannot lead", () => {
    const hand = [c("7", "CLUBS"), c("9", "SPADES")];
    const result = canPlayCards(hand, hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a valid combination/);
  });

  it("beatsTrick treats an empty trick as nothing to beat", () => {
    const hand = [c("7", "CLUBS")];
    expect(beatsTrick(hand, NO_LEAD, levelRank)).toEqual({ valid: true });
  });
});

describe("canPlayCards / beatsTrick: responding to a lead", () => {
  const levelRank = levelRankExcluding("7", "8", "9", "10");

  // Position is irrelevant to beatsTrick/canPlayCards (they only ever look at
  // the most recent play), so these helpers assign positions arbitrarily
  // just to satisfy CurrentTrick's shape.
  function trickWith(...plays: TrickPlay[]): CurrentTrick {
    return plays.map((play, i) => ({ position: (i % 4) as PlayerPosition, play }));
  }

  it("a higher single beats a lower single", () => {
    const trick = trickWith([c("7", "CLUBS")]);
    expect(beatsTrick([c("8", "SPADES")], trick, levelRank)).toEqual({ valid: true });
  });

  it("a lower single does not beat a higher single", () => {
    const trick = trickWith([c("8", "SPADES")]);
    const result = beatsTrick([c("7", "CLUBS")], trick, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/must beat/);
  });

  it("an equal-rank single does not beat it", () => {
    const trick = trickWith([c("7", "CLUBS")]);
    const result = beatsTrick([c("7", "SPADES")], trick, levelRank);
    expect(result.valid).toBe(false);
  });

  it("a pair cannot respond to a single lead", () => {
    const trick = trickWith([c("7", "CLUBS")]);
    const result = beatsTrick(nOfRank("9", 2), trick, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/must match/);
  });

  it("a higher straight beats a lower straight", () => {
    const trick = trickWith(straightFrom(0)); // 2-3-4-5-6
    expect(beatsTrick(straightFrom(1), trick, levelRank)).toEqual({ valid: true }); // 3-4-5-6-7
  });

  it("a shorter straight cannot respond to a five-card straight lead", () => {
    const trick = trickWith(straightFrom(0));
    const result = beatsTrick(straightFrom(1, 5).slice(0, 4), trick, levelRank);
    expect(result.valid).toBe(false);
  });

  it("must beat the most recent play, not the original lead", () => {
    // Lead: single 7. Second player: single 9 (raises the bar). Third
    // player must beat the 9, an 8 is no longer enough even though it beats
    // the original lead.
    const trick = trickWith([c("7", "CLUBS")], [c("9", "SPADES")]);
    const eight = beatsTrick([c("8", "CLUBS")], trick, levelRank);
    expect(eight.valid).toBe(false);

    const ten = beatsTrick([c("10", "CLUBS")], trick, levelRank);
    expect(ten.valid).toBe(true);
  });

  it("passes in between are skipped when finding what to beat", () => {
    const trick = trickWith([c("7", "CLUBS")], PASS, [c("9", "SPADES")], PASS);
    const result = beatsTrick([c("8", "CLUBS")], trick, levelRank);
    expect(result.valid).toBe(false); // still needs to beat the 9, not the 7

    const result2 = beatsTrick([c("10", "CLUBS")], trick, levelRank);
    expect(result2.valid).toBe(true);
  });

  it("a trick that's all PASS so far (no lead yet) is treated as an empty trick", () => {
    const trick = trickWith(PASS, PASS);
    expect(beatsTrick([c("7", "CLUBS")], trick, levelRank)).toEqual({ valid: true });
  });

  it("does not crash if the play being responded to is itself malformed", () => {
    const malformedLead: CardWithWild[] = [{ rank: "7", suit: "CLUBS" }, { rank: "8", suit: "CLUBS" }];
    const trick = trickWith(malformedLead); // two cards of different rank isn't any valid combo
    const result = beatsTrick([c("9", "CLUBS")], trick, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not a valid combination/);
  });
});

describe("canPlayCards / beatsTrick: bombs", () => {
  const levelRank = levelRankExcluding("7", "8", "9", "10");

  it("any bomb beats any ordinary combination", () => {
    const trick: CurrentTrick = lead(straightFrom(0)); // an ordinary straight lead
    expect(beatsTrick(nOfRank("9", 4), trick, levelRank)).toEqual({ valid: true });
  });

  it("an ordinary combination cannot beat a bomb", () => {
    const trick: CurrentTrick = lead(nOfRank("9", 4));
    const result = beatsTrick(straightFrom(0), trick, levelRank);
    expect(result.valid).toBe(false);
  });

  it("a higher-tier bomb beats a lower-tier bomb regardless of rank", () => {
    // straight_flush (tier 3) should beat bomb_4 (tier 1) even with a lower
    // face rank.
    const trick: CurrentTrick = lead(nOfRank("10", 4));
    const straightFlush = straightFrom(0).map((card) => ({ ...card, suit: "CLUBS" as const }));
    expect(beatsTrick(straightFlush, trick, levelRank)).toEqual({ valid: true });
  });

  it("within the same bomb tier, higher rank wins", () => {
    const trick: CurrentTrick = lead(nOfRank("7", 4));
    expect(beatsTrick(nOfRank("8", 4), trick, levelRank)).toEqual({ valid: true });
  });

  it("within the same bomb tier, a lower rank does not win", () => {
    const trick: CurrentTrick = lead(nOfRank("8", 4));
    const result = beatsTrick(nOfRank("7", 4), trick, levelRank);
    expect(result.valid).toBe(false);
  });

  it("a same-rank same-tier bomb (duplicate from the second deck) does not beat it", () => {
    const trick: CurrentTrick = lead(nOfRank("7", 4));
    const result = beatsTrick(nOfRank("7", 4), trick, levelRank);
    expect(result.valid).toBe(false);
  });

  it("the joker bomb beats every other bomb", () => {
    const trick: CurrentTrick = lead(nOfRank("10", 10)); // bomb_10, second-highest tier
    const jokerBomb = [j("RED_JOKER"), j("RED_JOKER"), j("BLACK_JOKER"), j("BLACK_JOKER")];
    expect(beatsTrick(jokerBomb, trick, levelRank)).toEqual({ valid: true });
  });

  it("a bigger bomb can respond even when the lead was an ordinary combo of a different type", () => {
    const trick: CurrentTrick = lead(nOfRank("7", 2)); // a pair lead
    expect(beatsTrick(nOfRank("9", 5), trick, levelRank)).toEqual({ valid: true }); // bomb_5
  });
});

describe("canPlayCards: end-to-end", () => {
  const levelRank: StandardRank = "5";

  it("rejects a play that isn't in hand even if it would otherwise beat the trick", () => {
    const hand = [c("8", "SPADES")];
    const trick: CurrentTrick = lead([c("7", "CLUBS")]);
    const result = canPlayCards([c("9", "SPADES")], hand, trick, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in hand/);
  });

  it("accepts a wild card used to beat the lead", () => {
    const wild: CardWithWild = { rank: "5", suit: "HEARTS", actsAs: { rank: "9", suit: "SPADES" } };
    const hand = [wild];
    const trick: CurrentTrick = lead([c("7", "CLUBS")]);
    expect(canPlayCards([wild], hand, trick, levelRank)).toEqual({ valid: true });
  });

  it("rejects zero cards played", () => {
    const hand = [c("7", "CLUBS")];
    const result = canPlayCards([], hand, NO_LEAD, levelRank);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/at least one card/);
  });
});

// Exhaustive sweep: for every ordinary-lead rank and every same-type response
// rank, canPlayCards agrees with plain numeric rank comparison.
describe("canPlayCards: exhaustive single-vs-single sweep", () => {
  const ranks = STANDARD_RANK_ORDER;

  for (const leadRank of ranks) {
    for (const responseRank of ranks) {
      const leadIndex = ranks.indexOf(leadRank);
      const responseIndex = ranks.indexOf(responseRank);
      const shouldBeat = responseIndex > leadIndex;
      // Keep the level card out of the pair being compared, so neither side
      // gets elevated and the expected result stays plain index comparison.
      const levelRank = levelRankExcluding(leadRank, responseRank);

      it(`${responseRank} vs lead ${leadRank}: ${shouldBeat ? "beats" : "does not beat"}`, () => {
        const trick: CurrentTrick = lead([c(leadRank, "CLUBS")]);
        const hand = [c(responseRank, "SPADES")];
        const result = canPlayCards([c(responseRank, "SPADES")], hand, trick, levelRank);
        expect(result.valid).toBe(shouldBeat);
      });
    }
  }
});
