// POST /api/game/[id]/choose-giver-card — RULES.md "Card Exchange" → "Best
// card, when tied": if the player giving their best card (4th place, or
// 3rd/4th place in a two-team lead) holds more than one card tied for that
// best rank, they choose which one to give — the same choice 1st place gets
// when 3rd's and 4th's cards tie against each other. startNextRound
// pauses a round on 'awaiting_giver_choice' (rather than picking one for
// them) when this comes up, storing the still-pending giver positions and
// each one's tied candidates' levelRank in game_state.pendingGiverChoice;
// this route collects one giver's choice at a time. Once every pending
// giver has resolved, it re-plans the exchange with all choices known —
// either handing off to choose-tribute/route.ts (if the resolved cards now
// tie with each other) or applying the transfers directly and moving on to
// 'card_exchange', exactly like startNextRound's own resolved-transfer
// path.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGameContext, type ParticipantRow } from "@/lib/gameDb";
import { encodeCard } from "@/lib/cardUtils";
import {
  bestCardCandidates,
  computeExchangeHandWrites,
  leaderPositionForTransfers,
  planInitialExchanges,
  toHandWrites,
} from "@/lib/gameRules/cardExchange";
import { getFinishResult } from "@/lib/gameRules/scoring";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type {
  CardExchangeActionData,
  CardWithWild,
  ChooseGiverCardRequest,
  ChooseGiverCardResponse,
  GameState,
  PlayerPosition,
  StandardRank,
} from "@/lib/types";

function invalidChoiceResponse(reason: string, status = 400) {
  return NextResponse.json(
    { success: false, error: "Invalid giver card choice", reason } satisfies ChooseGiverCardResponse,
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ChooseGiverCardRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, card } = parsed.body;
  if (!playerId || !card) {
    return NextResponse.json(
      { error: "playerId and card are required" },
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
  if (!round || round.status !== "awaiting_giver_choice") {
    return NextResponse.json(
      { error: "Round is not awaiting a giver card choice" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null) {
    return invalidChoiceResponse("playerId is not a seated participant", 403);
  }
  const position = caller.position;

  const pending = round.game_state.pendingGiverChoice;
  if (!pending) {
    // Shouldn't happen — startNextRound always sets this alongside the
    // 'awaiting_giver_choice' status — but stay defensive rather than
    // crashing on a malformed round.
    console.error(`Round ${round.id} is 'awaiting_giver_choice' with no pendingGiverChoice`);
    return NextResponse.json({ error: "Round has no pending giver choice" }, { status: 500 });
  }
  if (!pending.pendingPositions.includes(position)) {
    return invalidChoiceResponse("you do not owe a giver card choice", 403);
  }

  // The card must be one of this giver's own tied best-card candidates
  // (RULES.md "Best card, when tied") — recomputed fresh from their current
  // hand rather than trusted from the client, using the levelRank captured
  // when the tie was first detected (the game's team levels may already
  // have been promoted by now). Matched by physical identity (rank+suit),
  // same as every other card-ownership check in this codebase.
  const candidates = bestCardCandidates(caller.hand, pending.levelRank);
  const encodedCard = encodeCard(card);
  if (!candidates.some((c) => encodeCard(c) === encodedCard)) {
    return invalidChoiceResponse("card must be one of your own tied best cards");
  }

  const newPendingPositions = pending.pendingPositions.filter((p) => p !== position);
  const newResolvedCards = { ...pending.resolvedCards, [position]: card };

  // Records this giver's choice as its own write, independent of whatever
  // comes next — so if the further resolution below fails partway, the
  // choice itself (already durably correct) isn't lost or re-litigated.
  const recordedGameState: GameState = {
    ...round.game_state,
    pendingGiverChoice: {
      levelRank: pending.levelRank,
      pendingPositions: newPendingPositions,
      resolvedCards: newResolvedCards,
    },
  };
  const recordResult = await supabaseAdmin
    .from("game_rounds")
    .update({ game_state: recordedGameState })
    .eq("id", round.id)
    .eq("status", "awaiting_giver_choice")
    .select("*");
  if (recordResult.error) {
    console.error("Failed to record giver card choice", recordResult.error);
    return NextResponse.json({ error: "Failed to submit giver card choice" }, { status: 500 });
  }
  const recordedRound = recordResult.data?.[0];
  if (!recordedRound) {
    return NextResponse.json(
      { error: "the giver card choice was already submitted by another request" },
      { status: 409 },
    );
  }
  await broadcastToGame(gameId, "round_updated", recordedRound);

  if (newPendingPositions.length > 0) {
    // Another giver still owes a choice — nothing further to resolve yet.
    const response: ChooseGiverCardResponse = { success: true };
    return NextResponse.json(response);
  }

  return finalizeAfterGiverChoicesResolved(
    gameId,
    round.id,
    recordedGameState,
    pending.levelRank,
    newResolvedCards,
    round.finishing_positions ?? [],
    participants,
    playerId,
  );
}

// Every pending giver has now chosen — re-plans the exchange with all
// choices known to determine what's next (RULES.md "Two-Team Lead"'s
// cross-giver comparison, or straight to the exchange if there's nothing
// left to compare, e.g. a single-team lead's lone giver).
async function finalizeAfterGiverChoicesResolved(
  gameId: string,
  roundId: string,
  currentGameState: GameState,
  levelRank: StandardRank,
  resolvedGiverCards: Partial<Record<PlayerPosition, CardWithWild>>,
  finishingPositions: number[],
  participants: ParticipantRow[],
  playerId: string,
) {
  const seated = participants.filter(
    (p): p is ParticipantRow & { position: PlayerPosition } => p.position !== null,
  );
  const { combo } = getFinishResult(finishingPositions);
  const plan = planInitialExchanges(combo, finishingPositions, seated, levelRank, resolvedGiverCards);

  if (plan.needsGiverChoice || plan.cancelled) {
    // Shouldn't happen: cancellation is only ever based on raw hand
    // contents and was already checked before this round ever entered
    // 'awaiting_giver_choice'; every pending giver is resolved here by
    // construction (resolvedGiverCards now covers all of them). Stay
    // defensive rather than crashing on a state that implies a bug
    // elsewhere.
    console.error(`Unexpected re-plan outcome for round ${roundId} after every giver choice resolved`, plan);
    return NextResponse.json({ error: "Failed to resolve the card exchange" }, { status: 500 });
  }

  if (plan.needsChoice) {
    // RULES.md "Two-Team Lead": the two givers' resolved cards still tie in
    // rank — hand off to 1st place's own choice (choose-tribute/route.ts),
    // the same transition end-hand/route.ts makes for this case.
    const newGameState: GameState = {
      currentTrick: currentGameState.currentTrick,
      trickCount: currentGameState.trickCount,
      finishOrder: currentGameState.finishOrder,
      pendingTributeChoice: {
        thirdPosition: plan.thirdPosition,
        thirdCard: plan.thirdCard,
        fourthPosition: plan.fourthPosition,
        fourthCard: plan.fourthCard,
      },
    };
    const updateResult = await supabaseAdmin
      .from("game_rounds")
      .update({ status: "awaiting_tribute_choice", game_state: newGameState })
      .eq("id", roundId)
      .eq("status", "awaiting_giver_choice")
      .select("*");
    if (updateResult.error || !updateResult.data?.length) {
      console.error(
        "Failed to transition to awaiting_tribute_choice after giver choices resolved",
        updateResult.error,
      );
      return NextResponse.json(
        { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
        { status: 500 },
      );
    }
    await broadcastToGame(gameId, "round_updated", updateResult.data[0]);
    const response: ChooseGiverCardResponse = { success: true };
    return NextResponse.json(response);
  }

  // Fully resolved — apply the transfers and move on to 'card_exchange',
  // exactly like startNextRound's own resolved-transfer path. Also sets
  // leader_position now (RULES.md "Leader Selection": whoever gave up the
  // tribute card that went to 1st place) — the round isn't playable yet
  // (current_player_turn stays null), but exchange-cards/route.ts needs this
  // already in place once every return is in.
  const { transfers } = plan;
  const firstPos = finishingPositions.indexOf(1) as PlayerPosition;
  const leaderPosition = leaderPositionForTransfers(transfers, firstPos);
  const clearedGameState: GameState = {
    currentTrick: currentGameState.currentTrick,
    trickCount: currentGameState.trickCount,
    finishOrder: currentGameState.finishOrder,
  };
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ status: "card_exchange", game_state: clearedGameState, leader_position: leaderPosition })
    .eq("id", roundId)
    .eq("status", "awaiting_giver_choice")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim card-exchange transition after giver choices resolved", roundClaimResult.error);
    return NextResponse.json(
      { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
      { status: 500 },
    );
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return NextResponse.json(
      { error: "the round was already advanced by another request" },
      { status: 409 },
    );
  }

  const handWrites = toHandWrites(seated, computeExchangeHandWrites(seated, transfers));
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
            round_id: roundId,
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
      "Failed to persist card-exchange side effects after claiming the transition; rolling back",
      handResults.find((r) => r.error)?.error,
      actionResults.find((r) => r.error)?.error,
    );
    // Reverts to 'awaiting_giver_choice' with every choice still recorded
    // (pendingPositions empty) rather than the pre-choice state — the
    // choices themselves were already durably committed in the earlier,
    // separate write above, and only this further transition failed.
    // Accepted gap (matches exchange-cards/route.ts's own note on a similar
    // race): a retry has to be triggered some other way, since resubmitting
    // this same choice would now 403 ("you do not owe a giver card choice")
    // rather than re-attempting the finalize step.
    const revertGameState: GameState = {
      currentTrick: currentGameState.currentTrick,
      trickCount: currentGameState.trickCount,
      finishOrder: currentGameState.finishOrder,
      pendingGiverChoice: { levelRank, pendingPositions: [], resolvedCards: resolvedGiverCards },
    };
    await Promise.all([
      supabaseAdmin
        .from("game_rounds")
        .update({ status: "awaiting_giver_choice", game_state: revertGameState, leader_position: null })
        .eq("id", roundId)
        .eq("status", "card_exchange"),
      ...handWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
      ),
      ...actionResults
        .filter((r) => !r.error && r.data != null)
        .map((r) => supabaseAdmin.from("game_actions").delete().eq("id", (r.data as { id: string }).id)),
    ]);
    return NextResponse.json(
      { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
      { status: 500 },
    );
  }

  await Promise.all([
    broadcastToGame(gameId, "round_updated", claimedRound),
    ...actionResults.map((r) => broadcastToGame(gameId, "game_action", r.data)),
  ]);

  const response: ChooseGiverCardResponse = { success: true };
  return NextResponse.json(response);
}
