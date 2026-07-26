// Pure logic for RULES.md "Card Exchange (After Each Round)", shared by
// end-hand/route.ts (plans and applies the automatic "initial" half),
// choose-giver-card/route.ts (resolves a giver's own tie for their "best
// card"), and choose-tribute/route.ts (resolves a same-rank tie between the
// two givers' cards once 1st place has chosen). Kept here rather than
// inline in any one route so all three can import the same hand-write
// computation.
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

// A giver (3rd and/or 4th place) whose hand has multiple cards tied for
// their own "best card" (RULES.md "Card Exchange": "if the player giving
// their best card... holds more than one card tied for that best rank,
// they choose which one to give"). `candidates` always has 2+ entries —
// a unique best card never needs a choice, so it's never surfaced here at
// all (see resolveGiverCard).
export interface PendingGiverChoice {
  position: PlayerPosition;
  candidates: CardWithWild[];
}

export type ExchangePlan =
  // RULES.md "Cancelled if ... both Red Jokers": no cards change hands.
  | { cancelled: true; needsGiverChoice: false; needsChoice: false; transfers: [] }
  // One or both givers' own hands have a tie for their best card — paused
  // for their choice(s) before anything else (including the cross-giver
  // comparison below) can be computed.
  | { cancelled: false; needsGiverChoice: true; needsChoice: false; givers: PendingGiverChoice[] }
  // RULES.md "Two-Team Lead": 3rd and 4th's (now-resolved) best cards tied
  // in rank — 1st place must choose which to take before transfers can be
  // computed.
  | {
      cancelled: false;
      needsGiverChoice: false;
      needsChoice: true;
      thirdPosition: PlayerPosition;
      thirdCard: CardWithWild;
      fourthPosition: PlayerPosition;
      fourthCard: CardWithWild;
    }
  | { cancelled: false; needsGiverChoice: false; needsChoice: false; transfers: ExchangeTransfer[] };

function countRedJokers(hand: readonly CardWithWild[]): number {
  return hand.filter((card) => card.rank === "RED_JOKER").length;
}

// Every card in `hand` tied for the best (highest-`compareCards`) value —
// RULES.md "Best card, when tied". Re-sorts every call rather than trusting
// the hand's existing order — deck.ts's dealHands() sorts a hand once at
// deal time for a nicer initial display, but that's a one-time
// presentational sort, not an invariant: nothing keeps a hand sorted as
// cards are added/removed by play or exchange, so this can't assume the
// highest card is already at either end. Always returns at least one card
// (never called with an empty hand — a giver always has cards left when
// their round concludes with them in 3rd/4th). Exported so
// choose-giver-card/route.ts can re-validate a submitted card against this
// same candidate set rather than trusting it outright.
export function bestCardCandidates(hand: readonly CardWithWild[], levelRank: StandardRank): CardWithWild[] {
  const sorted = sortCards(hand, levelRank);
  const best = sorted[sorted.length - 1];
  let start = sorted.length - 1;
  while (start > 0 && compareCards(sorted[start - 1], best, levelRank) === 0) start--;
  return sorted.slice(start);
}

// Resolves one giver's contribution: an explicit prior choice (from
// resolvedGiverCards, once they've picked among a tie), the sole candidate
// if their hand has no tie, or the full tied candidate list if they still
// owe a choice.
function resolveGiverCard(
  position: PlayerPosition,
  hand: readonly CardWithWild[],
  levelRank: StandardRank,
  resolvedGiverCards: Partial<Record<PlayerPosition, CardWithWild>>,
): { card: CardWithWild } | { candidates: CardWithWild[] } {
  const resolved = resolvedGiverCards[position];
  if (resolved) return { card: resolved };

  const candidates = bestCardCandidates(hand, levelRank);
  return candidates.length === 1 ? { card: candidates[0] } : { candidates };
}

// The automatic "initial" half of RULES.md "Card Exchange (After Each
// Round)": who gives which card to whom, before either recipient has made
// any choice of their own. `levelRank` is this *just-finished* hand's level
// (the higher of the two pre-promotion team levels) — the card values in
// effect while that hand's cards were actually in play. `resolvedGiverCards`
// carries any giver's already-made choice among their own tied candidates
// (RULES.md "Best card, when tied") — empty until choose-giver-card/route.ts
// records one.
export function planInitialExchanges(
  combo: FinishCombo,
  finishingPositions: readonly number[],
  participants: readonly ParticipantHands[],
  levelRank: StandardRank,
  resolvedGiverCards: Partial<Record<PlayerPosition, CardWithWild>> = {},
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
      return { cancelled: true, needsGiverChoice: false, needsChoice: false, transfers: [] };
    }

    const fourthResolution = resolveGiverCard(fourthPos, fourthHand, levelRank, resolvedGiverCards);
    if ("candidates" in fourthResolution) {
      return {
        cancelled: false,
        needsGiverChoice: true,
        needsChoice: false,
        givers: [{ position: fourthPos, candidates: fourthResolution.candidates }],
      };
    }
    // Single-team lead (RULES.md "Single-Team Lead"): 4th's best card goes
    // to 1st, no other exchange.
    return {
      cancelled: false,
      needsGiverChoice: false,
      needsChoice: false,
      transfers: [{ from: fourthPos, to: firstPos, card: fourthResolution.card }],
    };
  }

  const secondPos = posByRank(2);
  const thirdPos = posByRank(3);
  const thirdHand = handOf(thirdPos);
  // RULES.md "Card Exchange" → "Cancelled if 3rd and 4th place hold both
  // Red Jokers between them" — combined across both losing players,
  // however they're split between the two hands.
  if (countRedJokers(thirdHand) + countRedJokers(fourthHand) === 2) {
    return { cancelled: true, needsGiverChoice: false, needsChoice: false, transfers: [] };
  }

  // Two-team lead (RULES.md "Two-Team Lead"): 3rd and 4th both give their
  // best card. Either (or both) may still owe their own giver's choice
  // (RULES.md "Best card, when tied") before there's anything to compare.
  const thirdResolution = resolveGiverCard(thirdPos, thirdHand, levelRank, resolvedGiverCards);
  const fourthResolution = resolveGiverCard(fourthPos, fourthHand, levelRank, resolvedGiverCards);
  const givers: PendingGiverChoice[] = [];
  if ("candidates" in thirdResolution) givers.push({ position: thirdPos, candidates: thirdResolution.candidates });
  if ("candidates" in fourthResolution) givers.push({ position: fourthPos, candidates: fourthResolution.candidates });
  if (givers.length > 0) {
    return { cancelled: false, needsGiverChoice: true, needsChoice: false, givers };
  }

  // Both givers resolved (TypeScript can't see that from `givers.length ===
  // 0` alone, but it's guaranteed by construction above — each pushed iff
  // its resolution had `candidates`, so neither does here) — the `"card" in`
  // branch is always the one taken.
  const thirdCard = "card" in thirdResolution ? thirdResolution.card : thirdResolution.candidates[0];
  const fourthCard = "card" in fourthResolution ? fourthResolution.card : fourthResolution.candidates[0];

  // RULES.md "Two-Team Lead": the higher rank goes to 1st, the lower to
  // 2nd. RULES.md has 1st choose which card to take when the two are tied
  // in rank — surfaced here as needsChoice so the caller can pause for that
  // decision instead of resolving it arbitrarily.
  const comparison = compareCards(thirdCard, fourthCard, levelRank);
  if (comparison === 0) {
    return {
      cancelled: false,
      needsGiverChoice: false,
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
    needsGiverChoice: false,
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
