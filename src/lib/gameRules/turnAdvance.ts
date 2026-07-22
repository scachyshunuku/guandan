// Turn/trick progression for the play-cards and pass routes
// (IMPLEMENTATION.md Task 3.2), built on top of Task 2.4's
// calculateTrickWinner/calculateNextLeader (gameRules/scoring.ts). Kept in
// its own module rather than added to scoring.ts: this is route-orchestration
// state advancement (given an in-flight trick and who's already out, what
// happens next), not the trick-winner/round-end/promotion *rules* scoring.ts
// owns.

import type { CurrentTrick, GameState, PlayerPosition, TrickEntry } from "../types";
import { calculateNextLeader, calculateTrickWinner } from "./scoring";

const ALL_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// The next position to act after `current`, skipping anyone who has already
// gone out (RULES.md: a player who's emptied their hand takes no further
// turns). Callers must halt play via detectRoundEnd before the round is
// down to a single active player — this throws rather than silently
// returning a wrong answer if that invariant is ever violated.
export function nextActivePosition(
  current: PlayerPosition,
  finishOrder: readonly PlayerPosition[],
): PlayerPosition {
  // Only offsets 1-3: offset 4 wraps back to `current` itself, which would
  // otherwise look like a legitimately "active, not in finishOrder" answer
  // and be returned as if handing the turn to oneself is meaningful.
  for (let offset = 1; offset <= 3; offset++) {
    const candidate = ((current + offset) % 4) as PlayerPosition;
    if (!finishOrder.includes(candidate)) return candidate;
  }
  throw new Error("nextActivePosition: no other active position to hand the turn to");
}

export interface TrickAdvance {
  currentTrick: CurrentTrick;
  trickCount: number;
  leaderPosition: PlayerPosition;
  currentPlayerTurn: PlayerPosition;
}

// Appends `entry` (a play or a pass) to the trick and returns the resulting
// turn/trick state: either handing the turn to the next active position, or
// — once every position active at the time has acted — resolving the trick
// to its winner, who leads next (their partner instead, if the winner's own
// play just emptied their hand — RULES.md "Leader Selection": "Winner out
// of cards"). `finishOrder` must already reflect this entry's effect (i.e.
// include the acting position if this exact play emptied their hand).
export function advanceTrick(
  currentTrick: CurrentTrick,
  entry: TrickEntry,
  finishOrder: readonly PlayerPosition[],
  leaderPosition: PlayerPosition,
  trickCount: number,
): TrickAdvance {
  const updatedTrick: CurrentTrick = [...currentTrick, entry];

  // Every position active when this trick could still be contested must
  // act exactly once — including one who goes out on this very entry, who
  // already has (which is why this checks `finishOrder`, evaluated *after*
  // this entry, rather than requiring a fixed count of 4).
  const activePositions = ALL_POSITIONS.filter((p) => !finishOrder.includes(p));
  const trickComplete = activePositions.every((p) => updatedTrick.some((e) => e.position === p));

  if (trickComplete) {
    const winner = calculateTrickWinner(updatedTrick);
    // scoring.ts's calculateNextLeader assumes callers check detectRoundEnd
    // first — this doesn't, since a caller whose entry just concluded the
    // round is expected to freeze current_player_turn afterward and ignore
    // this result's leaderPosition rather than act on it. Computed
    // unconditionally anyway (rather than branching around it) since it's
    // cheap and harmless to compute; don't repurpose this return value's
    // leaderPosition for anything once the round has actually ended.
    const nextLeader = calculateNextLeader(winner, !finishOrder.includes(winner));
    return {
      currentTrick: [],
      trickCount: trickCount + 1,
      leaderPosition: nextLeader,
      currentPlayerTurn: nextLeader,
    };
  }

  return {
    currentTrick: updatedTrick,
    trickCount,
    leaderPosition,
    currentPlayerTurn: nextActivePosition(entry.position, finishOrder),
  };
}

// Builds the full GameState to persist from an advance and the (possibly
// grown) finish order, mirroring the {currentTrick, trickCount} +
// finishOrder split game_rounds.game_state stores.
export function toGameState(advance: TrickAdvance, finishOrder: readonly PlayerPosition[]): GameState {
  return {
    currentTrick: advance.currentTrick,
    trickCount: advance.trickCount,
    finishOrder: [...finishOrder],
  };
}
