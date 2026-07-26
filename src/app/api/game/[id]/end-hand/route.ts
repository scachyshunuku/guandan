// POST /api/game/[id]/end-hand — see ARCHITECTURE.md section 7 ("End Hand /
// Level") and IMPLEMENTATION.md Task 3.3. Once a round has concluded (Task
// 3.2's play-cards freezes it by setting current_player_turn to null once
// detectRoundEnd is satisfied), this resolves the finishing positions,
// applies the level promotion, and checks the game-win condition. If the
// game isn't won outright, it also computes the automatic "initial" half of
// the card exchange (RULES.md "Card Exchange (After Each Round)") and moves
// the round into 'card_exchange' so exchange-cards (this task's other
// route) can collect the player-selected "return" half.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getGameContext,
  levelRankForGame,
  type GameRow,
  type GameRoundRow,
  type ParticipantRow,
} from "@/lib/gameDb";
import { dealNextRound } from "@/lib/dealNextRound";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import {
  ACE_LEVEL,
  calculateLevelPromotion,
  detectRoundEnd,
  getFinishResult,
  type FinishCombo,
} from "@/lib/gameRules/scoring";
import {
  computeExchangeHandWrites,
  planInitialExchanges,
  toHandWrites,
  type ExchangePlan,
} from "@/lib/gameRules/cardExchange";
import type {
  CardWithWild,
  CardExchangeActionData,
  EndHandRequest,
  EndHandResponse,
  GameState,
  PlayerPosition,
  StandardRank,
} from "@/lib/types";

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

  // The level this just-finished hand was played at (RULES.md "Level Cards
  // & Wild Cards"), captured before promotion below changes it — that's
  // what the cards in players' hands were actually worth while this hand
  // was in play, which is what the initial exchange's "best card" needs.
  const levelRank = levelRankForGame(game);
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
    levelRank,
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

async function finalizeContinuingHand(
  game: GameRow,
  playerId: string,
  round: GameRoundRow,
  participants: ParticipantRow[],
  finishingPositions: number[],
  combo: FinishCombo,
  levelRank: StandardRank,
  teamALevel: number,
  teamBLevel: number,
) {
  // A concluded round's finishing positions only ever cover seats 0-3
  // (detectRoundEnd), so the exchange logic only needs — and only accepts —
  // seated participants, never a spectator's position: null row.
  const seated = participants.filter(
    (p): p is ParticipantRow & { position: PlayerPosition } => p.position !== null,
  );
  const plan = planInitialExchanges(combo, finishingPositions, seated, levelRank);
  // RULES.md "Card Exchange" tribute-cancellation: with nothing changing
  // hands, there's no "return" phase to wait on either — finalize and deal
  // the next round immediately instead of moving through 'card_exchange'.
  if (plan.cancelled) {
    return finalizeCancelledTribute(game, round, finishingPositions, teamALevel, teamBLevel);
  }
  // RULES.md "Card Exchange" → "Best card, when tied": one or both givers'
  // own hands have a tie for their best card — pause on
  // 'awaiting_giver_choice' for them to decide (choose-giver-card/route.ts)
  // before anything past that (including the cross-giver comparison below)
  // can even be computed. Checked before needsChoice: a genuine cross-giver
  // tie can't be detected until each giver's own contribution is settled.
  if (plan.needsGiverChoice) {
    return finalizePendingGiverChoice(game, round, finishingPositions, plan, levelRank, teamALevel, teamBLevel);
  }
  // RULES.md "Two-Team Lead": 3rd/4th's best cards tied in rank — pause on
  // 'awaiting_tribute_choice' for 1st place to decide (choose-tribute/
  // route.ts) rather than resolving the tie arbitrarily. Level promotion
  // still applies now; it doesn't depend on the outcome of that choice.
  if (plan.needsChoice) {
    return finalizePendingTributeChoice(game, round, finishingPositions, plan, teamALevel, teamBLevel);
  }
  const { transfers } = plan;

  // See finalizeWonGame's identical comment: capture before any write
  // mutates these same live row objects (round.finishing_positions,
  // game.team_a_level/team_b_level) out from under this function's still-held
  // references to them.
  const originalFinishingPositions = round.finishing_positions;
  const originalTeamALevel = game.team_a_level;
  const originalTeamBLevel = game.team_b_level;
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ finishing_positions: finishingPositions, status: "card_exchange" })
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

  const handWrites = toHandWrites(seated, computeExchangeHandWrites(seated, transfers));

  const [gameUpdateResult, handResults, actionResults] = await Promise.all([
    supabaseAdmin
      .from("games")
      .update({ team_a_level: teamALevel, team_b_level: teamBLevel })
      .eq("id", game.id)
      .eq("status", "in_progress")
      .select("*"),
    Promise.all(
      handWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.newHand }).eq("id", w.id),
      ),
    ),
    Promise.all(
      transfers.map((t) => {
        const actionData: CardExchangeActionData = {
          from: t.from,
          to: t.to,
          card: t.card,
          type: "initial",
        };
        return supabaseAdmin
          .from("game_actions")
          .insert({
            game_id: game.id,
            round_id: round.id,
            player_id: playerId,
            action_type: "card_exchange",
            action_data: actionData,
          })
          .select("*")
          .single();
      }),
    ),
  ]);

  const gameUpdateFailed = Boolean(gameUpdateResult.error) || !gameUpdateResult.data?.length;
  const failed = gameUpdateFailed || handResults.some((r) => r.error) || actionResults.some((r) => r.error);
  if (failed) {
    console.error(
      "Failed to persist end-hand side effects after claiming the transition; rolling back",
      gameUpdateResult.error,
      handResults.find((r) => r.error)?.error,
      actionResults.find((r) => r.error)?.error,
    );
    await rollbackEndHandTransition(
      game,
      round,
      originalFinishingPositions,
      originalTeamALevel,
      originalTeamBLevel,
      handWrites,
      actionResults,
    );
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data![0]),
    ...actionResults.map((r) => broadcastToGame(game.id, "game_action", r.data)),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

// A cancelled tribute (RULES.md "Card Exchange") has no cards to move and
// no return to wait on, so this claims the round straight to 'completed'
// (skipping 'card_exchange' entirely — unlike finalizeContinuingHand's
// normal path, exchange-cards is never involved for this round) and deals
// the next round itself via the same dealNextRound helper exchange-cards
// uses once its own returns are all in.
async function finalizeCancelledTribute(
  game: GameRow,
  round: GameRoundRow,
  finishingPositions: number[],
  teamALevel: number,
  teamBLevel: number,
) {
  // See finalizeWonGame's identical comment on capturing these before any
  // write mutates the live row objects they're read from.
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
      "Failed to persist level promotion for a cancelled-tribute hand; rolling back",
      gameUpdateResult.error,
    );
    await supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "completed");
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  const leaderPosition = finishingPositions.indexOf(1) as PlayerPosition;
  const outcome = await dealNextRound(
    game.id,
    round.round_number,
    leaderPosition,
    levelRankForGame({ team_a_level: teamALevel, team_b_level: teamBLevel }),
  );
  if (outcome === "error") {
    console.error("Failed to deal the next round after a cancelled tribute; rolling back");
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

  // dealNextRound already broadcasts the new round itself; only the game's
  // level change (and, for a cancelled tribute, the fact that nothing else
  // changed hands) is this function's own news to announce.
  await broadcastToGame(game.id, "game_updated", gameUpdateResult.data[0]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

// RULES.md "Card Exchange" → "Best card, when tied": one or both givers'
// own hands have multiple cards tied for their best card — they must
// choose which to give (choose-giver-card/route.ts resolves each choice)
// before there's anything to hand off further, including the cross-giver
// comparison finalizePendingTributeChoice handles. Level promotion still
// applies now, same as every other continuing-hand path; only the
// transfers themselves wait on the choice(s).
async function finalizePendingGiverChoice(
  game: GameRow,
  round: GameRoundRow,
  finishingPositions: number[],
  plan: Extract<ExchangePlan, { needsGiverChoice: true }>,
  levelRank: StandardRank,
  teamALevel: number,
  teamBLevel: number,
) {
  const originalFinishingPositions = round.finishing_positions;

  const newGameState: GameState = {
    currentTrick: round.game_state.currentTrick,
    trickCount: round.game_state.trickCount,
    finishOrder: round.game_state.finishOrder,
    pendingGiverChoice: {
      levelRank,
      pendingPositions: plan.givers.map((g) => g.position),
      resolvedCards: {},
    },
  };

  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({
      finishing_positions: finishingPositions,
      status: "awaiting_giver_choice",
      game_state: newGameState,
    })
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
    .update({ team_a_level: teamALevel, team_b_level: teamBLevel })
    .eq("id", game.id)
    .eq("status", "in_progress")
    .select("*");
  if (gameUpdateResult.error || !gameUpdateResult.data?.length) {
    console.error(
      "Failed to persist level promotion while pausing for a giver card choice; rolling back",
      gameUpdateResult.error,
    );
    await supabaseAdmin
      .from("game_rounds")
      .update({
        finishing_positions: originalFinishingPositions,
        status: "in_progress",
        game_state: round.game_state,
      })
      .eq("id", round.id)
      .eq("status", "awaiting_giver_choice");
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data[0]),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

// RULES.md "Two-Team Lead": 3rd/4th's best cards tied in rank — 1st place
// must choose which to take before the exchange's transfers can be computed
// (choose-tribute/route.ts resolves that choice and applies them). Level
// promotion still applies now, same as the resolved-transfer path above;
// only the transfers themselves wait on the choice.
async function finalizePendingTributeChoice(
  game: GameRow,
  round: GameRoundRow,
  finishingPositions: number[],
  plan: Extract<ExchangePlan, { needsChoice: true }>,
  teamALevel: number,
  teamBLevel: number,
) {
  const originalFinishingPositions = round.finishing_positions;

  const newGameState: GameState = {
    currentTrick: round.game_state.currentTrick,
    trickCount: round.game_state.trickCount,
    finishOrder: round.game_state.finishOrder,
    pendingTributeChoice: {
      thirdPosition: plan.thirdPosition,
      thirdCard: plan.thirdCard,
      fourthPosition: plan.fourthPosition,
      fourthCard: plan.fourthCard,
    },
  };

  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({
      finishing_positions: finishingPositions,
      status: "awaiting_tribute_choice",
      game_state: newGameState,
    })
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
    .update({ team_a_level: teamALevel, team_b_level: teamBLevel })
    .eq("id", game.id)
    .eq("status", "in_progress")
    .select("*");
  if (gameUpdateResult.error || !gameUpdateResult.data?.length) {
    console.error(
      "Failed to persist level promotion while pausing for a tribute choice; rolling back",
      gameUpdateResult.error,
    );
    await supabaseAdmin
      .from("game_rounds")
      .update({
        finishing_positions: originalFinishingPositions,
        status: "in_progress",
        game_state: round.game_state,
      })
      .eq("id", round.id)
      .eq("status", "awaiting_tribute_choice");
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data[0]),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

// Undoes a claimed round transition's downstream writes (level promotion,
// hand transfers, action log) after one of them fails partway. The round
// revert is conditional on the round still being 'card_exchange' — see
// play-cards/route.ts's rollbackClaim for why an unconditional revert would
// risk stomping a legitimate later write — while the games/hands/actions
// reverts are unconditional-by-id, since nothing else can touch this game's
// levels or these participants' hands until this same round cycles back to
// 'in_progress'.
async function rollbackEndHandTransition(
  game: GameRow,
  round: GameRoundRow,
  originalFinishingPositions: number[] | null,
  originalTeamALevel: number,
  originalTeamBLevel: number,
  handWrites: { id: string; originalHand: CardWithWild[] }[],
  actionResults: { data: unknown; error: unknown }[],
) {
  const results = await Promise.all([
    supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "card_exchange"),
    supabaseAdmin
      .from("games")
      .update({ team_a_level: originalTeamALevel, team_b_level: originalTeamBLevel })
      .eq("id", game.id),
    ...handWrites.map((w) =>
      supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
    ),
    ...actionResults
      .filter((r): r is { data: { id: string }; error: null } => !r.error && r.data != null)
      .map((r) => supabaseAdmin.from("game_actions").delete().eq("id", r.data.id)),
  ]);
  for (const result of results) {
    if (result.error) {
      console.error("Failed to roll back game_rounds/games/hand state after failed end-hand write", result.error);
    }
  }
}
