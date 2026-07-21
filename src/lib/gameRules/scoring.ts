// Trick winners, round-end detection, and level promotion. See RULES.md
// "Trick Resolution", "End Hand / Level", and "Scoring"; ARCHITECTURE.md
// section 2 (games.team_a_level/team_b_level, game_rounds.finishing_positions).
//
// IMPLEMENTATION.md sketches detectRoundEnd as taking `participants` (i.e.
// GameParticipant[], each carrying a `hand`). That's not quite enough on its
// own: RULES.md's finishing positions are 1st/2nd/3rd/4th *in the order hands
// emptied*, and a hand-emptiness snapshot alone can't recover that order once
// more than one player is already out. combinations.ts/validation.ts sidestep
// the analogous problem by working on plain Card[]/CardWithWild[] rather than
// DB row types; detectRoundEnd follows the same pattern and takes the order
// itself (a list of positions, in the order they went out) rather than
// participants — leaving "did this hand just become empty" as the trivial
// caller-side check it is (`hand.length === 0`) when a future task wires this
// into the play-cards API route.

import type { CurrentTrick, PlayerPosition, Team } from "../types";
import { PASS } from "../types";

// ---------------------------------------------------------------------------
// Trick winner (RULES.md "Trick Resolution")
// ---------------------------------------------------------------------------

const ALL_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// The winner of a trick is whoever made the last non-PASS play (RULES.md:
// "The player who played the last card(s) wins the trick"). Entry `n` of
// currentTrick was made by position (leaderPosition + n) % 4 (see CurrentTrick
// in types.ts), so the winner is found by walking backward from the most
// recent entry to the most recent play. Works whether the trick has fully
// resolved (three trailing passes) or is still mid-flight (in which case this
// is "whoever's currently winning") — callers decide when a trick is over.
export function calculateTrickWinner(
  currentTrick: CurrentTrick,
  leaderPosition: PlayerPosition,
): PlayerPosition {
  for (let i = currentTrick.length - 1; i >= 0; i--) {
    if (currentTrick[i] !== PASS) {
      return ((leaderPosition + i) % 4) as PlayerPosition;
    }
  }
  throw new Error("calculateTrickWinner: currentTrick has no plays to determine a winner from");
}

// ---------------------------------------------------------------------------
// Round end detection (RULES.md "End Hand / Level")
// ---------------------------------------------------------------------------

// Whether the round has concluded given the order players have gone out so
// far, and if so, the complete finishing-position array (1-4, one entry per
// player position — mirrors GameRound.finishingPositions / ARCHITECTURE.md's
// `[1, 4, 2, 3]` example). A round concludes once three players have emptied
// their hands: the fourth is placed last automatically, since RULES.md never
// requires them to actually finish playing (nothing left to contest once
// only one player has cards). Returns null while fewer than three positions
// are known, meaning the round is still in progress.
export function detectRoundEnd(finishOrder: readonly PlayerPosition[]): number[] | null {
  if (new Set(finishOrder).size !== finishOrder.length) {
    throw new Error(`detectRoundEnd: finishOrder has a duplicate position: ${finishOrder.join(",")}`);
  }
  if (finishOrder.some((p) => !ALL_POSITIONS.includes(p))) {
    throw new Error(`detectRoundEnd: finishOrder has an out-of-range position: ${finishOrder.join(",")}`);
  }
  if (finishOrder.length < 3) return null;

  const finishingPositions = new Array<number>(4).fill(0);
  finishOrder.forEach((position, i) => {
    finishingPositions[position] = i + 1;
  });

  if (finishOrder.length === 3) {
    const lastPosition = ALL_POSITIONS.find((p) => !finishOrder.includes(p))!;
    finishingPositions[lastPosition] = 4;
  }

  return finishingPositions;
}

// ---------------------------------------------------------------------------
// Level promotion (RULES.md "Scoring")
// ---------------------------------------------------------------------------

export const STARTING_LEVEL = 2;
export const ACE_LEVEL = 14;

// Team A = positions 0 & 2, Team B = positions 1 & 3 (RULES.md "Players &
// Teams"); partners always sit exactly two seats apart.
function positionTeam(position: PlayerPosition): Team {
  return (position % 2) as Team;
}

export type FinishCombo = "1-2" | "1-3" | "1-4";

export interface FinishResult {
  winningTeam: Team;
  combo: FinishCombo;
}

// Which team finished 1st this hand, and how their partner placed relative to
// the other team (RULES.md "Promotion Rules (per hand)"). `finishingPositions`
// must be a concluded round's array (as returned by detectRoundEnd): exactly
// one position ranked 1, one ranked 2, etc.
export function getFinishResult(finishingPositions: readonly number[]): FinishResult {
  const winnerPosition = finishingPositions.findIndex((rank) => rank === 1) as PlayerPosition;
  const winningTeam = positionTeam(winnerPosition);

  const partnerPosition = ((winnerPosition + 2) % 4) as PlayerPosition;
  const partnerRank = finishingPositions[partnerPosition];
  const combo: FinishCombo = partnerRank === 2 ? "1-2" : partnerRank === 3 ? "1-3" : "1-4";

  return { winningTeam, combo };
}

// Levels gained by the winning team for each finish combo (RULES.md
// "Promotion Rules (per hand)"). The losing team never advances.
const PROMOTION_LEVELS: Record<FinishCombo, number> = {
  "1-2": 4,
  "1-3": 2,
  "1-4": 1,
};

// The new [teamA, teamB] levels after a concluded hand, capped at Ace
// (RULES.md "Winning Condition": a team that reaches level A without a 1-2/
// 1-3 finish stays at A and replays rather than being promoted past it).
// Mirrors the `[teamALevel, teamBLevel]` tuple convention used by
// store/gameStore.ts's `teamLevels`.
export function calculateLevelPromotion(
  finishingPositions: readonly number[],
  currentLevels: readonly [number, number],
): [number, number] {
  const { winningTeam, combo } = getFinishResult(finishingPositions);
  const promotedLevel = Math.min(currentLevels[winningTeam] + PROMOTION_LEVELS[combo], ACE_LEVEL);

  return winningTeam === 0 ? [promotedLevel, currentLevels[1]] : [currentLevels[0], promotedLevel];
}
