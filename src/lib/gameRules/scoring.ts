// Trick winner determination (RULES.md "Trick Resolution"). Only
// calculateTrickWinner is implemented here — detectRoundEnd and
// calculateLevelPromotion, the rest of IMPLEMENTATION.md Task 2.4's planned
// surface for this file, aren't needed until Task 3.3 (hand end / card
// exchange) and remain unimplemented.
//
// Per types.ts's CurrentTrick doc comment, a trick here is always exactly
// one rotation: the leader's play plus each of the other 3 positions acting
// once (play or pass). So the trick's winner is whoever made the last
// non-PASS entry — every response has to beat the previous non-PASS play to
// be accepted (see gameRules/validation.ts's beatsTrick), so the last one
// standing is necessarily the strongest.

import type { CurrentTrick, GameState, PlayerPosition, TrickPlay } from "../types";
import { PASS } from "../types";

export function calculateTrickWinner(
  currentTrick: CurrentTrick,
  leaderPosition: PlayerPosition,
): PlayerPosition {
  for (let i = currentTrick.length - 1; i >= 0; i--) {
    if (currentTrick[i] !== PASS) {
      return ((leaderPosition + i) % 4) as PlayerPosition;
    }
  }
  throw new Error("trick has no plays to determine a winner from");
}

export interface TrickAdvance {
  gameState: GameState;
  leaderPosition: PlayerPosition;
  currentPlayerTurn: PlayerPosition;
}

// Shared by the play-cards and pass routes (IMPLEMENTATION.md Task 3.2):
// appends `entry` (a play or a PASS) to the trick and returns the resulting
// round state — either handing the turn to the next position, or, once all 4
// positions have acted this trick, resolving it to its winner (who leads
// next, per RULES.md "Trick Resolution").
export function advanceTrick(
  currentTrick: CurrentTrick,
  entry: TrickPlay,
  leaderPosition: PlayerPosition,
  actingPosition: PlayerPosition,
  trickCount: number,
): TrickAdvance {
  const updatedTrick: CurrentTrick = [...currentTrick, entry];

  if (updatedTrick.length === 4) {
    const winner = calculateTrickWinner(updatedTrick, leaderPosition);
    return {
      gameState: { currentTrick: [], trickCount: trickCount + 1 },
      leaderPosition: winner,
      currentPlayerTurn: winner,
    };
  }

  return {
    gameState: { currentTrick: updatedTrick, trickCount },
    leaderPosition,
    currentPlayerTurn: ((actingPosition + 1) % 4) as PlayerPosition,
  };
}
