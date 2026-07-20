// Play validation: is a proposed play legal given the player's hand and the
// trick so far? See RULES.md "Play Structure" / "Valid Plays" and
// ARCHITECTURE.md section 3. Builds on combinations.ts (combo shape/ranking)
// and adds the two things that module deliberately leaves out: resolving
// wild cards to the card they're impersonating, and comparing a candidate
// play against what's already on the table.
//
// IMPLEMENTATION.md sketches this module's surface as `canPlayCards`,
// `isBeatingStraight`, and `beatsTrick`. `beatsTrick` is here as planned.
// `isBeatingStraight` doesn't survive as its own function: combinations.ts's
// getComboRank already gives straights/tubes/plates a rank comparable with
// `>` the same way singles/pairs/bombs are, so the "same type, higher rank"
// comparison below (`beatsCombo`) is generic across every combo type rather
// than needing straight-specific logic.

import type { Card, CardWithWild, CurrentTrick, StandardRank } from "../types";
import { PASS } from "../types";
import { encodeCard } from "../cardUtils";
import { getComboRank, getComboType, isBombComboType } from "./combinations";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const VALID: ValidationResult = { valid: true };

// ---------------------------------------------------------------------------
// Wild cards (RULES.md "Level Cards & Wild Cards")
// ---------------------------------------------------------------------------

// The card a played card counts as for combo purposes: whatever it's
// impersonating if it's wild, otherwise itself. Callers must have already
// confirmed the wild claim is legal (validateCardsToPlay) — this just
// resolves.
export function resolveCard(card: CardWithWild): Card {
  return card.actsAs ?? { rank: card.rank, suit: card.suit };
}

export function resolveCards(cards: CardWithWild[]): Card[] {
  return cards.map(resolveCard);
}

// ---------------------------------------------------------------------------
// Ownership & wild-card legality
// ---------------------------------------------------------------------------

// encodeCard throws on a malformed card (e.g. a standard rank missing its
// suit). cardsToPlay comes straight from a client request with no runtime
// shape guarantee, so a malformed entry must fail validation like any other
// illegal play, not crash the caller.
function tryEncodeCard(card: CardWithWild): string | null {
  try {
    return encodeCard(card);
  } catch {
    return null;
  }
}

// Checks one played card against the remaining-in-hand pool (mutating it on
// success) and, in the same pass, that any wild-card claim it makes is legal.
// Combined into one per-card check — rather than a separate ownership pass
// and a separate wild-usage pass over cardsToPlay — so validateCardsToPlay
// only has to loop over cardsToPlay once.
function validatePlayedCard(
  card: CardWithWild,
  available: Map<string, number>,
  levelRank: StandardRank,
): ValidationResult {
  // Only the level-rank heart may be played as a stand-in for another card
  // (never a joker — `actsAs` is typed to StandardRank so that's already
  // ruled out at compile time).
  if (card.actsAs !== undefined && (card.rank !== levelRank || card.suit !== "HEARTS")) {
    return { valid: false, reason: "only the level-rank heart can be played as a wild card" };
  }

  // Ownership is checked by (rank, suit) identity, ignoring `actsAs`, since
  // that's a claim about how the card is being played, not which physical
  // card it is.
  const key = tryEncodeCard(card);
  if (key === null) {
    return { valid: false, reason: "malformed card" };
  }
  const remaining = available.get(key) ?? 0;
  if (remaining === 0) {
    return { valid: false, reason: `card not in hand: ${key}` };
  }
  available.set(key, remaining - 1);

  return VALID;
}

// Every played card must correspond to a physical card still in hand, and
// any wild-card claim it makes must be legal. A multiset match (not just
// `.includes`) since the double deck means the same (rank, suit) can
// legitimately appear twice in a hand.
function validateCardsToPlay(
  cardsToPlay: CardWithWild[],
  hand: CardWithWild[],
  levelRank: StandardRank,
): ValidationResult {
  const available = new Map<string, number>();
  for (const card of hand) {
    const key = tryEncodeCard(card);
    if (key === null) continue; // hand comes from the DB, not client input; skip rather than fail
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  for (const card of cardsToPlay) {
    const result = validatePlayedCard(card, available, levelRank);
    if (!result.valid) return result;
  }

  return VALID;
}

// ---------------------------------------------------------------------------
// Beating the trick (RULES.md "Trick Resolution", "Playing Rules")
// ---------------------------------------------------------------------------

// The play a response must beat: the most recent non-PASS entry, not
// necessarily the trick's opening lead (RULES.md's worked example has each
// responder beat the previous player, not just the leader). `null` means the
// trick hasn't had a play yet, i.e. this play would be the opening lead.
function lastPlayedCombo(currentTrick: CurrentTrick): CardWithWild[] | null {
  for (let i = currentTrick.length - 1; i >= 0; i--) {
    const entry = currentTrick[i];
    if (entry !== PASS) return entry;
  }
  return null;
}

// Does `challenger` legally beat `defender` (the play it's responding to)?
// Any bomb beats any non-bomb (RULES.md "Bomb Rules"); two bombs compare by
// tier then value; two non-bombs must be the *same* ordinary combo type and
// then compare by value. getComboRank's bomb tiers are scaled (tier * 1000 +
// value) specifically so that every bomb outranks every ordinary combo
// numerically — see combinations.ts — which is what lets the bomb-vs-bomb and
// bomb-vs-ordinary cases below share one numeric comparison instead of a
// third branch.
function beatsCombo(challenger: Card[], defender: Card[], levelRank: StandardRank): ValidationResult {
  const challengerType = getComboType(challenger);
  const defenderType = getComboType(defender);
  if (challengerType === null) {
    return { valid: false, reason: "not a valid combination" };
  }
  // defender is always a previously-validated play, but stay defensive rather
  // than asserting: a malformed currentTrick shouldn't crash validation.
  if (defenderType === null) {
    return { valid: false, reason: "the play being responded to is not a valid combination" };
  }

  const challengerIsBomb = isBombComboType(challengerType);
  const defenderIsBomb = isBombComboType(defenderType);
  if (!challengerIsBomb && !defenderIsBomb && challengerType !== defenderType) {
    return { valid: false, reason: `must match the combination type on the table (${defenderType})` };
  }

  const challengerRank = getComboRank(challenger, levelRank)!;
  const defenderRank = getComboRank(defender, levelRank)!;
  if (challengerRank <= defenderRank) {
    return { valid: false, reason: "must beat the last play" };
  }

  return VALID;
}

// Does `cardsToPlay` legally beat the current state of the trick? Leading an
// empty trick has nothing to beat, so any valid combination (ordinary or
// bomb — RULES.md "When Leading") is playable.
export function beatsTrick(
  cardsToPlay: CardWithWild[],
  currentTrick: CurrentTrick,
  levelRank: StandardRank,
): ValidationResult {
  const lead = lastPlayedCombo(currentTrick);
  if (lead === null) {
    const comboType = getComboType(resolveCards(cardsToPlay));
    return comboType === null ? { valid: false, reason: "not a valid combination" } : VALID;
  }

  return beatsCombo(resolveCards(cardsToPlay), resolveCards(lead), levelRank);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Full legality check for a proposed play: the player must actually hold
// these cards, any wild-card claims must be legal, and the resulting
// combination must be able to beat whatever's currently on the table (or, if
// the trick is empty, just be a valid combination).
export function canPlayCards(
  cardsToPlay: CardWithWild[],
  hand: CardWithWild[],
  currentTrick: CurrentTrick,
  levelRank: StandardRank,
): ValidationResult {
  if (cardsToPlay.length === 0) {
    return { valid: false, reason: "must play at least one card" };
  }

  const cardsValidation = validateCardsToPlay(cardsToPlay, hand, levelRank);
  if (!cardsValidation.valid) return cardsValidation;

  return beatsTrick(cardsToPlay, currentTrick, levelRank);
}
