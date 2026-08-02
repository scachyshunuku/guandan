// End the hand — see ARCHITECTURE.md section 7 ("End Hand / Level") and
// IMPLEMENTATION.md Task 3.3. Once a round has concluded (playCards.ts
// freezes it by setting current_player_turn to null once detectRoundEnd is
// satisfied), this resolves the finishing positions, applies the level
// promotion, and checks the game-win condition. If the game isn't won
// outright, it hands off to startNextRound (lib/startNextRound.ts), which
// deals the next round's cards immediately and plans the tribute exchange
// (RULES.md "Card Exchange (After Each Round)") against that new hand —
// before any card is given or returned. Called by both end-hand/route.ts
// (an HTTP request from a human) and the bot runner (an in-process call
// from a bot).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getGameContext,
  levelRankForGame,
  type GameRow,
  type GameRoundRow,
  type ParticipantRow,
} from "@/lib/gameDb";
import { startNextRound } from "@/lib/startNextRound";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import {
  ACE_LEVEL,
  calculateLevelPromotion,
  detectRoundEnd,
  getFinishResult,
  type FinishCombo,
} from "@/lib/gameRules/scoring";
import type { ActionResult } from "./actionResult";
import type { EndHandResponse, RoundEndedActionData } from "@/lib/types";

// Logs the audit-trail entry for a round's own finishing order (RULES.md
// "Round End") — separate from the per-play "player_finished" entries
// play-cards.ts logs as each player actually empties their hand, since a
// 1-2/1-3/1-4 finish always auto-assigns at least one seat's place without
// them ever playing out (RULES.md: "the 4th is automatically placed last";
// a 1-2 finish assigns 3rd/4th outright) - this is the only entry GameHistory
// can rely on to show all four seats' places at once. Best-effort like
// play-cards.ts's own trick_end/player_finished logging: called only once
// the round's completion is already durably persisted (no rollback path left
// that could strand an entry describing a transition that got reverted), so
// a failure here only skips this supplementary log, never the transition
// itself.
async function logRoundEnded(
  gameId: string,
  roundId: string,
  playerId: string,
  finishingPositions: number[],
): Promise<Record<string, unknown> | null> {
  const actionData: RoundEndedActionData = { finishingPositions };
  const { data, error } = await supabaseAdmin
    .from("game_actions")
    .insert({
      game_id: gameId,
      round_id: roundId,
      player_id: playerId,
      action_type: "round_ended",
      action_data: actionData,
    })
    .select("*")
    .single();
  if (error) {
    console.error("Failed to log round_ended game_action", error);
    return null;
  }
  return data;
}

export async function endHand(
  gameId: string,
  playerId: string,
): Promise<ActionResult<EndHandResponse | { error: string }>> {
  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return { status: 404, body: { error: "Game not found" } };
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return { status: 400, body: { error: "Game is not in progress" } };
  }
  if (!round || round.status !== "in_progress") {
    return { status: 400, body: { error: "Round is not awaiting hand-end resolution" } };
  }
  if (!caller || caller.position === null) {
    return { status: 403, body: { error: "Only a seated player can end the hand" } };
  }

  const finishingPositions = detectRoundEnd(round.game_state.finishOrder);
  if (!finishingPositions) {
    return { status: 400, body: { error: "Round has not concluded yet" } };
  }

  const { winningTeam, combo } = getFinishResult(finishingPositions);
  const [teamALevel, teamBLevel] = calculateLevelPromotion(finishingPositions, [
    game.team_a_level,
    game.team_b_level,
  ]);
  const promotedLevel = winningTeam === 0 ? teamALevel : teamBLevel;
  // RULES.md "Winning Condition": only a 1-2/1-3 finish that lands the
  // winning team AT level A ends the game outright — reaching A via a 1-4
  // (or already sitting at A and failing to repeat 1-2/1-3) just means they
  // "remain at level A and play another hand" instead. calculateLevelPromotion
  // already caps promotion at ACE_LEVEL for exactly that scenario.
  const gameEnded = promotedLevel === ACE_LEVEL && (combo === "1-2" || combo === "1-3");

  if (gameEnded) {
    return finalizeWonGame(game, playerId, round, finishingPositions, teamALevel, teamBLevel, winningTeam);
  }
  return finalizeContinuingHand(
    game,
    playerId,
    round,
    participants,
    finishingPositions,
    combo,
    teamALevel,
    teamBLevel,
  );
}

async function finalizeWonGame(
  game: GameRow,
  playerId: string,
  round: GameRoundRow,
  finishingPositions: number[],
  teamALevel: number,
  teamBLevel: number,
  winningTeam: 0 | 1,
): Promise<ActionResult<EndHandResponse | { error: string }>> {
  // Captured now, before any write: `round` came straight from
  // getLatestRound (unlike resolveTurn's callers, it isn't a defensive
  // shallow copy), so reading round.finishing_positions again after the
  // claim below has mutated it would see the *new* value, not the one a
  // rollback needs to restore.
  const originalFinishingPositions = round.finishing_positions;
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ finishing_positions: finishingPositions, status: "completed" })
    .eq("id", round.id)
    .eq("status", "in_progress")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim end-hand transition", roundClaimResult.error);
    return { status: 500, body: { error: "Failed to end hand" } };
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return { status: 409, body: { error: "hand was already ended by another request" } };
  }

  const gameUpdateResult = await supabaseAdmin
    .from("games")
    .update({
      team_a_level: teamALevel,
      team_b_level: teamBLevel,
      status: "completed",
      winning_team: winningTeam,
    })
    .eq("id", game.id)
    .eq("status", "in_progress")
    .select("*");
  if (gameUpdateResult.error || !gameUpdateResult.data?.length) {
    console.error(
      "Failed to persist game-won state after claiming the round transition; rolling back",
      gameUpdateResult.error,
    );
    const { error: rollbackError } = await supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "completed");
    if (rollbackError) {
      console.error("Failed to roll back game_rounds after failed end-hand write", rollbackError);
    }
    return { status: 500, body: { error: "Failed to end hand" } };
  }

  // No rollback path remains past this point - both writes above already
  // succeeded, so it's safe to log the round_ended entry now.
  const roundEndedRow = await logRoundEnded(game.id, round.id, playerId, finishingPositions);

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data![0]),
    ...(roundEndedRow ? [broadcastToGame(game.id, "game_action", roundEndedRow)] : []),
  ]);

  return { status: 200, body: { success: true } };
}

// RULES.md "Card Exchange": claims the just-finished round straight to
// 'completed' (there's no more play left in it, and no version of the
// exchange happens on this round any more — see startNextRound), applies the
// level promotion, then hands off to startNextRound to deal the next round's
// cards and plan the tribute exchange against that new hand. startNextRound
// creates the new round already in whatever status its plan lands on
// ('in_progress' for a cancelled tribute, 'awaiting_giver_choice'/
// 'awaiting_tribute_choice' for a tie, or 'card_exchange' once resolved) —
// this function doesn't need to know or branch on which.
async function finalizeContinuingHand(
  game: GameRow,
  playerId: string,
  round: GameRoundRow,
  participants: ParticipantRow[],
  finishingPositions: number[],
  combo: FinishCombo,
  teamALevel: number,
  teamBLevel: number,
): Promise<ActionResult<EndHandResponse | { error: string }>> {
  // See finalizeWonGame's identical comment: capture before any write
  // mutates these same live row objects (round.finishing_positions,
  // game.team_a_level/team_b_level) out from under this function's still-held
  // references to them.
  const originalFinishingPositions = round.finishing_positions;
  const originalTeamALevel = game.team_a_level;
  const originalTeamBLevel = game.team_b_level;

  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ finishing_positions: finishingPositions, status: "completed" })
    .eq("id", round.id)
    .eq("status", "in_progress")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim end-hand transition", roundClaimResult.error);
    return { status: 500, body: { error: "Failed to end hand" } };
  }
  if (!roundClaimResult.data?.length) {
    return { status: 409, body: { error: "hand was already ended by another request" } };
  }

  const gameUpdateResult = await supabaseAdmin
    .from("games")
    .update({ team_a_level: teamALevel, team_b_level: teamBLevel })
    .eq("id", game.id)
    .eq("status", "in_progress")
    .select("*");
  if (gameUpdateResult.error || !gameUpdateResult.data?.length) {
    console.error(
      "Failed to persist level promotion after claiming the round transition; rolling back",
      gameUpdateResult.error,
    );
    await supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "completed");
    return { status: 500, body: { error: "Failed to end hand" } };
  }

  // The *new* hand's level (the higher of the two post-promotion team
  // levels) — startNextRound deals and plans the tribute exchange against
  // this level's cards, not the just-finished hand's.
  const newLevelRank = levelRankForGame({ team_a_level: teamALevel, team_b_level: teamBLevel });
  const outcome = await startNextRound(
    game.id,
    round.round_number,
    finishingPositions,
    combo,
    playerId,
    newLevelRank,
    participants,
  );
  if (outcome === "error") {
    console.error("Failed to start the next round after ending the hand; rolling back");
    await Promise.all([
      supabaseAdmin
        .from("game_rounds")
        .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
        .eq("id", round.id)
        .eq("status", "completed"),
      supabaseAdmin
        .from("games")
        .update({ team_a_level: originalTeamALevel, team_b_level: originalTeamBLevel })
        .eq("id", game.id),
    ]);
    return { status: 500, body: { error: "Failed to end hand" } };
  }

  // No rollback path remains past this point - startNextRound already
  // succeeded, so it's safe to log the just-finished round's own round_ended
  // entry now (tagged with *its* id, not the new round's - this describes
  // the round that ended, same as trick_end/player_finished describe the
  // round they occurred in).
  const roundEndedRow = await logRoundEnded(game.id, round.id, playerId, finishingPositions);

  // startNextRound already broadcasts the new round itself; only the game's
  // level change (and this round_ended entry) are this function's own news
  // to announce. Deliberately not also broadcasting the just-claimed round's
  // own transition to 'completed': sending it before startNextRound risks
  // announcing a state that a subsequent startNextRound failure then rolls
  // back with no correcting broadcast, and sending it after risks arriving
  // out of order relative to startNextRound's own broadcast for the new
  // round — which would reset the client's roundActions and trigger a
  // spurious refetch (applyRoundUpdate treats any roundId change as a fresh
  // round). This single-broadcast-per-transition is the same tradeoff every
  // other transition in this app already makes (e.g. play-cards/pass) — a
  // dropped broadcast self-heals via the next one or a reconnect, not a
  // redundant send here. round_ended doesn't carry that same risk (it's a
  // supplementary log entry, not round/game state a client applies), so it's
  // broadcast alongside game_updated regardless of ordering.
  await Promise.all([
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data[0]),
    ...(roundEndedRow ? [broadcastToGame(game.id, "game_action", roundEndedRow)] : []),
  ]);

  return { status: 200, body: { success: true } };
}
