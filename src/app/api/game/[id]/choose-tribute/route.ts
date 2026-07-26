// POST /api/game/[id]/choose-tribute — RULES.md "Two-Team Lead": "If the two
// cards are the same rank, 1st place chooses which card to take (then 2nd
// place gets the other)." end-hand/route.ts pauses a round on
// 'awaiting_tribute_choice' (rather than resolving the tie arbitrarily) when
// this comes up, storing the tied cards in game_state.pendingTributeChoice;
// this route collects 1st place's choice, applies both transfers, logs them
// as 'initial' card_exchange actions (matching the non-tied path in
// end-hand/route.ts), and moves the round on to 'card_exchange' so
// exchange-cards can collect the "return" half exactly as it already does.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGameContext, isPlayerPosition, type ParticipantRow } from "@/lib/gameDb";
import {
  computeExchangeHandWrites,
  toHandWrites,
  type ExchangeTransfer,
} from "@/lib/gameRules/cardExchange";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type {
  CardExchangeActionData,
  CardWithWild,
  ChooseTributeRequest,
  ChooseTributeResponse,
  GameState,
  PlayerPosition,
} from "@/lib/types";

function invalidChoiceResponse(reason: string, status = 400) {
  return NextResponse.json(
    { success: false, error: "Invalid tribute choice", reason } satisfies ChooseTributeResponse,
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ChooseTributeRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, take } = parsed.body;
  if (!playerId || !isPlayerPosition(take)) {
    return NextResponse.json(
      { error: "playerId and a valid take are required" },
      { status: 400 },
    );
  }

  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return NextResponse.json({ error: "Game is not in progress" }, { status: 400 });
  }
  if (!round || round.status !== "awaiting_tribute_choice") {
    return NextResponse.json(
      { error: "Round is not awaiting a tribute choice" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null) {
    return invalidChoiceResponse("playerId is not a seated participant", 403);
  }
  const position = caller.position;

  const pending = round.game_state.pendingTributeChoice;
  if (!pending) {
    // Shouldn't happen — end-hand/route.ts always sets this alongside the
    // 'awaiting_tribute_choice' status — but stay defensive rather than
    // crashing on a malformed round.
    console.error(`Round ${round.id} is 'awaiting_tribute_choice' with no pendingTributeChoice`);
    return NextResponse.json({ error: "Round has no pending tribute choice" }, { status: 500 });
  }

  const firstPos = round.finishing_positions?.indexOf(1);
  if (firstPos !== position) {
    return invalidChoiceResponse("only 1st place can choose the tribute card", 403);
  }
  if (take !== pending.thirdPosition && take !== pending.fourthPosition) {
    return invalidChoiceResponse("take must be one of the two tied positions");
  }
  const secondPos = round.finishing_positions?.indexOf(2) as PlayerPosition;

  // RULES.md "Two-Team Lead": whichever tied card 1st place doesn't take
  // goes to 2nd place instead.
  const transfers: ExchangeTransfer[] =
    take === pending.thirdPosition
      ? [
          { from: pending.thirdPosition, to: position, card: pending.thirdCard },
          { from: pending.fourthPosition, to: secondPos, card: pending.fourthCard },
        ]
      : [
          { from: pending.fourthPosition, to: position, card: pending.fourthCard },
          { from: pending.thirdPosition, to: secondPos, card: pending.thirdCard },
        ];

  const seated = participants.filter(
    (p): p is ParticipantRow & { position: PlayerPosition } => p.position !== null,
  );
  const handWrites = toHandWrites(seated, computeExchangeHandWrites(seated, transfers));

  // Clears pendingTributeChoice now that it's resolved — kept off
  // game_state entirely rather than left stale, since nothing should ever
  // read it again once the round has moved past 'awaiting_tribute_choice'.
  const newGameState: GameState = {
    currentTrick: round.game_state.currentTrick,
    trickCount: round.game_state.trickCount,
    finishOrder: round.game_state.finishOrder,
  };
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ status: "card_exchange", game_state: newGameState })
    .eq("id", round.id)
    .eq("status", "awaiting_tribute_choice")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim choose-tribute transition", roundClaimResult.error);
    return NextResponse.json({ error: "Failed to submit tribute choice" }, { status: 500 });
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return NextResponse.json(
      { error: "the tribute choice was already submitted by another request" },
      { status: 409 },
    );
  }

  const [handResults, actionResults] = await Promise.all([
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
            game_id: gameId,
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

  const failed = handResults.some((r) => r.error) || actionResults.some((r) => r.error);
  if (failed) {
    console.error(
      "Failed to persist choose-tribute side effects after claiming the transition; rolling back",
      handResults.find((r) => r.error)?.error,
      actionResults.find((r) => r.error)?.error,
    );
    await rollbackChooseTribute(round.id, round.game_state, handWrites, actionResults);
    return NextResponse.json({ error: "Failed to submit tribute choice" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(gameId, "round_updated", claimedRound),
    ...actionResults.map((r) => broadcastToGame(gameId, "game_action", r.data)),
  ]);

  const response: ChooseTributeResponse = { success: true };
  return NextResponse.json(response);
}

async function rollbackChooseTribute(
  roundId: string,
  originalGameState: GameState,
  handWrites: { id: string; originalHand: CardWithWild[] }[],
  actionResults: { data: unknown; error: unknown }[],
) {
  const results = await Promise.all([
    supabaseAdmin
      .from("game_rounds")
      .update({ status: "awaiting_tribute_choice", game_state: originalGameState })
      .eq("id", roundId)
      .eq("status", "card_exchange"),
    ...handWrites.map((w) =>
      supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
    ),
    ...actionResults
      .filter((r): r is { data: { id: string }; error: null } => !r.error && r.data != null)
      .map((r) => supabaseAdmin.from("game_actions").delete().eq("id", r.data.id)),
  ]);
  for (const result of results) {
    if (result.error) {
      console.error("Failed to roll back game_rounds/hand state after failed choose-tribute write", result.error);
    }
  }
}

