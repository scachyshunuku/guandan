// Trivial non-trick decisions for an all-bot game (IMPLEMENTATION.md
// Phase 7): the card-exchange choices a bot must make outside of trick
// play. Each candidate set involved is already tied/equal by construction
// (see the call sites in lib/gameRules/cardExchange.ts), so picking
// arbitrarily is a legitimate choice, not a shortcut around real strategy.
import { sortCards } from "@/lib/cardUtils";
import type { Card, CardWithWild, PlayerPosition, StandardRank } from "@/lib/types";

// RULES.md "Best card, when tied": all candidates are tied by
// compareCards — any choice is legal.
export function pickGiverCard(candidates: readonly Card[]): Card {
  return candidates[0];
}

// RULES.md "Two-Team Lead": the two tribute cards are tied by rank — any
// choice is legal.
export function pickTributeTake(thirdPosition: PlayerPosition): PlayerPosition {
  return thirdPosition;
}

// RULES.md "Card Exchange": the mandatory return is "typically a low card".
export function pickExchangeReturnCard(hand: CardWithWild[], levelRank: StandardRank): Card {
  return sortCards(hand, levelRank)[0];
}
