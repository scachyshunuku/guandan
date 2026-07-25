// Pure logic for RULES.md "Card Exchange (After Each Round)", shared by
// end-hand/route.ts (plans and applies the automatic "initial" half) and
// choose-tribute/route.ts (resolves a same-rank tie in the initial half once
// 1st place has chosen). Kept here rather than inline in either route so
// both can import the same hand-write computation.
import { compareCards, sortCards } from "../cardUtils";
import { removeCardsFromHand } from "../cardUtils";
import type { CardWithWild, PlayerPosition, StandardRank } from "../types";
import type { FinishCombo } from "./scoring";

export interface ParticipantHands {
  position: PlayerPosition;
  hand: CardWithWild[];
}

// Adds the DB row id computeExchangeHandWrites' pure position-keyed output
// doesn't carry, so callers (end-hand/route.ts, choose-tribute/route.ts) can
// turn its result straight into a `.eq("id", ...)` update — and the
// original hand each write replaced, for their rollback-on-failure paths.
export interface ParticipantHandRow extends ParticipantHands {
  id: string;
}

export interface ExchangeTransfer {
  from: PlayerPosition;
  to: PlayerPosition;
  card: CardWithWild;
}

export type ExchangePlan =
  // RULES.md "Cancelled if ... both Red Jokers": no cards change hands.
  | { cancelled: true; needsChoice: false; transfers: [] }
  // RULES.md "Two-Team Lead": 3rd and 4th's best cards tied in rank — 1st
  // place must choose which to take before transfers can be computed.
  | {
      cancelled: false;
      needsChoice: true;
      thirdPosition: PlayerPosition;
      thirdCard: CardWithWild;
      fourthPosition: PlayerPosition;
      fourthCard: CardWithWild;
    }
  | { cancelled: false; needsChoice: false; transfers: ExchangeTransfer[] };

function countRedJokers(hand: readonly CardWithWild[]): number {
  return hand.filter((card) => card.rank === "RED_JOKER").length;
}

// Re-sorts every call rather than trusting the hand's existing order —
// deck.ts's dealHands() sorts a hand once at deal time for a nicer initial
// display, but that's a one-time presentational sort, not an invariant:
// nothing keeps a hand sorted as cards are added/removed by play or
// exchange, so this can't assume the highest card is already at either end.
function bestCard(hand: readonly CardWithWild[], levelRank: StandardRank): CardWithWild {
  const sorted = sortCards(hand, levelRank);
  return sorted[sorted.length - 1];
}

// The automatic "initial" half of RULES.md "Card Exchange (After Each
// Round)": who gives which card to whom, before either recipient has made
// any choice of their own. `levelRank` is this *just-finished* hand's level
// (the higher of the two pre-promotion team levels) — the card values in
// effect while that hand's cards were actually in play.
export function planInitialExchanges(
  combo: FinishCombo,
  finishingPositions: readonly number[],
  participants: readonly ParticipantHands[],
  levelRank: StandardRank,
): ExchangePlan {
  const posByRank = (rank: number) => finishingPositions.indexOf(rank) as PlayerPosition;
  const handOf = (position: PlayerPosition) =>
    participants.find((p) => p.position === position)!.hand;

  const firstPos = posByRank(1);
  const fourthPos = posByRank(4);
  const fourthHand = handOf(fourthPos);

  if (combo !== "1-2") {
    // RULES.md "Card Exchange" → "Cancelled if 4th place alone holds both
    // Red Jokers": the tribute is called off entirely, no card either way.
    if (countRedJokers(fourthHand) === 2) {
      return { cancelled: true, needsChoice: false, transfers: [] };
    }
    // Single-team lead (RULES.md "Single-Team Lead"): 4th's best card goes
    // to 1st, no other exchange.
    return {
      cancelled: false,
      needsChoice: false,
      transfers: [{ from: fourthPos, to: firstPos, card: bestCard(fourthHand, levelRank) }],
    };
  }

  const secondPos = posByRank(2);
  const thirdPos = posByRank(3);
  const thirdHand = handOf(thirdPos);
  // RULES.md "Card Exchange" → "Cancelled if 3rd and 4th place hold both
  // Red Jokers between them" — combined across both losing players,
  // however they're split between the two hands.
  if (countRedJokers(thirdHand) + countRedJokers(fourthHand) === 2) {
    return { cancelled: true, needsChoice: false, transfers: [] };
  }

  // Two-team lead (RULES.md "Two-Team Lead"): 3rd and 4th both give their
  // best card; the higher rank goes to 1st, the lower to 2nd. RULES.md has
  // 1st choose which card to take when the two are tied in rank — surfaced
  // here as needsChoice so the caller can pause for that decision instead of
  // resolving it arbitrarily.
  const fourthCard = bestCard(fourthHand, levelRank);
  const thirdCard = bestCard(thirdHand, levelRank);
  const comparison = compareCards(thirdCard, fourthCard, levelRank);
  if (comparison === 0) {
    return {
      cancelled: false,
      needsChoice: true,
      thirdPosition: thirdPos,
      thirdCard,
      fourthPosition: fourthPos,
      fourthCard,
    };
  }
  const thirdIsHigher = comparison > 0;
  return {
    cancelled: false,
    needsChoice: false,
    transfers: [
      { from: thirdPos, to: thirdIsHigher ? firstPos : secondPos, card: thirdCard },
      { from: fourthPos, to: thirdIsHigher ? secondPos : firstPos, card: fourthCard },
    ],
  };
}

// Resolves each transfer against the participants' current hands into a
// flat list of per-participant hand writes. A map keyed by position (not a
// direct mutation of the participant rows) so a from/to pair that happened
// to share a position would still compose correctly — even though today's
// transfers never do (from is always 3rd/4th, to is always 1st/2nd).
export function computeExchangeHandWrites(
  participants: readonly ParticipantHands[],
  transfers: readonly ExchangeTransfer[],
): { position: PlayerPosition; newHand: CardWithWild[] }[] {
  const byPosition = new Map<PlayerPosition, ParticipantHands>();
  for (const p of participants) {
    byPosition.set(p.position, p);
  }

  const newHandByPosition = new Map<PlayerPosition, CardWithWild[]>();
  for (const { from, to, card } of transfers) {
    const fromHand = newHandByPosition.get(from) ?? byPosition.get(from)!.hand;
    const toHand = newHandByPosition.get(to) ?? byPosition.get(to)!.hand;
    newHandByPosition.set(from, removeCardsFromHand(fromHand, [card]));
    newHandByPosition.set(to, [...toHand, card]);
  }

  return [...newHandByPosition.entries()].map(([position, newHand]) => ({ position, newHand }));
}

// Resolves computeExchangeHandWrites' position-keyed output against each
// participant's DB row id, for the `.eq("id", ...)` update and
// rollback-on-failure paths both routes above share.
export function toHandWrites(
  participants: readonly ParticipantHandRow[],
  writes: readonly { position: PlayerPosition; newHand: CardWithWild[] }[],
): { id: string; originalHand: CardWithWild[]; newHand: CardWithWild[] }[] {
  return writes.map(({ position, newHand }) => {
    const participant = participants.find((p) => p.position === position)!;
    return { id: participant.id, originalHand: participant.hand, newHand };
  });
}
