// POST /api/game/[id]/end-hand — see ARCHITECTURE.md section 7 ("End Hand /
// Level") and IMPLEMENTATION.md Task 3.3. Once a round has concluded (Task
// 3.2's play-cards freezes it by setting current_player_turn to null once
// detectRoundEnd is satisfied), this resolves the finishing positions,
// applies the level promotion, and checks the game-win condition. If the
// game isn't won outright, it hands off to startNextRound (lib/startNextRound.ts),
// which deals the next round's cards immediately and plans the tribute
// exchange (RULES.md "Card Exchange (After Each Round)") against that new
// hand — before any card is given or returned.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getGameContext,
  levelRankForGame,
  type GameRow,
  type GameRoundRow,
  type ParticipantRow,
} from "@/lib/gameDb";
import { startNextRound } from "@/lib/startNextRound";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import {
  ACE_LEVEL,
  calculateLevelPromotion,
  detectRoundEnd,
  getFinishResult,
  type FinishCombo,
} from "@/lib/gameRules/scoring";
import type { EndHandRequest, EndHandResponse } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<EndHandRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return NextResponse.json({ error: "Game is not in progress" }, { status: 400 });
  }
  if (!round || round.status !== "in_progress") {
    return NextResponse.json(
      { error: "Round is not awaiting hand-end resolution" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null) {
    return NextResponse.json(
      { error: "Only a seated player can end the hand" },
      { status: 403 },
    );
  }

  const finishingPositions = detectRoundEnd(round.game_state.finishOrder);
  if (!finishingPositions) {
    return NextResponse.json({ error: "Round has not concluded yet" }, { status: 400 });
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
    return finalizeWonGame(game, round, finishingPositions, teamALevel, teamBLevel, winningTeam);
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
  round: GameRoundRow,
  finishingPositions: number[],
  teamALevel: number,
  teamBLevel: number,
  winningTeam: 0 | 1,
) {
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
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return NextResponse.json(
      { error: "hand was already ended by another request" },
      { status: 409 },
    );
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
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data![0]),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
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
) {
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
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }
  if (!roundClaimResult.data?.length) {
    return NextResponse.json(
      { error: "hand was already ended by another request" },
      { status: 409 },
    );
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
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
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
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  // startNextRound already broadcasts the new round itself; only the game's
  // level change is this function's own news to announce. Deliberately not
  // also broadcasting the just-claimed round's own transition to
  // 'completed': sending it before startNextRound risks announcing a state
  // that a subsequent startNextRound failure then rolls back with no
  // correcting broadcast, and sending it after risks arriving out of order
  // relative to startNextRound's own broadcast for the new round — which
  // would reset the client's roundActions and trigger a spurious refetch
  // (applyRoundUpdate treats any roundId change as a fresh round). This
  // single-broadcast-per-transition is the same tradeoff every other
  // transition in this app already makes (e.g. play-cards/pass) — a dropped
  // broadcast self-heals via the next one or a reconnect, not a redundant
  // send here.
  await broadcastToGame(game.id, "game_updated", gameUpdateResult.data[0]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}
