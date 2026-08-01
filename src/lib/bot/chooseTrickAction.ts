// Trivial trick-play decision for an all-bot game (IMPLEMENTATION.md
// Phase 7). Deliberately scoped to only what an all-bot game can ever
// produce: every bot always leads the single lowest card in its hand (see
// below), so every trick's combo type is always "single" — there's no
// pair/triple/straight/tube/plate/bomb generation here, since a bot never
// needs to lead or beat anything but a single. If a future task gives bots
// a smarter leading strategy, this will need pair/triple/etc. candidate
// generation too.
//
// Pure and DB-free so it's directly unit-testable; every candidate is still
// run through canPlayCards before being returned — correctness comes from
// that existing validator, not from this generation logic being trusted
// blindly.
import { sortCards } from "@/lib/cardUtils";
import { canPlayCards, lastPlayedCombo } from "@/lib/gameRules/validation";
import type { CardWithWild, CurrentTrick, StandardRank } from "@/lib/types";

export type BotTrickDecision =
  | { action: "play"; cards: CardWithWild[] }
  | { action: "pass" };

export function chooseTrickAction(
  hand: CardWithWild[],
  currentTrick: CurrentTrick,
  levelRank: StandardRank,
): BotTrickDecision {
  const sortedHand = sortCards(hand, levelRank);

  if (currentTrick.length === 0) {
    // Leading: play the lowest single. Never sets `actsAs` — the bot never
    // claims a wild-card substitution, so it always plays cards (including
    // a level-rank heart) at face value. A bare single is always a valid
    // combo, but still validated below rather than trusted outright.
    const lead = [sortedHand[0]];
    return canPlayCards(lead, hand, currentTrick, levelRank).valid
      ? { action: "play", cards: lead }
      : { action: "pass" };
  }

  // Following: lastPlayedCombo(currentTrick) is never null here — a trick
  // can't open with a pass. Try the lowest card in hand that legally beats
  // it; sorted order guarantees the first validating candidate is the
  // lowest legal beat.
  const defender = lastPlayedCombo(currentTrick);
  if (defender === null) {
    return { action: "pass" };
  }
  for (const card of sortedHand) {
    const candidate = [card];
    if (canPlayCards(candidate, hand, currentTrick, levelRank).valid) {
      return { action: "play", cards: candidate };
    }
  }
  return { action: "pass" };
}
