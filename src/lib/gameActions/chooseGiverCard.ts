// Choose which tied card to give — RULES.md "Card Exchange" → "Best card,
// when tied": if the player giving their best card (4th place, or 3rd/4th
// place in a two-team lead) holds more than one card tied for that best
// rank, they choose which one to give — the same choice 1st place gets when
// 3rd's and 4th's cards tie against each other. startNextRound pauses a
// round on 'awaiting_giver_choice' (rather than picking one for them) when
// this comes up, storing the still-pending giver positions and each one's
// tied candidates' levelRank in game_state.pendingGiverChoice; this
// function collects one giver's choice at a time. Once every pending giver
// has resolved, it re-plans the exchange with all choices known — either
// handing off to choose-tribute (if the resolved cards now tie with each
// other) or applying the transfers directly and moving on to
// 'card_exchange', exactly like startNextRound's own resolved-transfer
// path. Called by both choose-giver-card/route.ts (an HTTP request from a
// human) and the bot runner (an in-process call from a bot).
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
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { ActionResult } from "./actionResult";
import type {
  Card,
  CardExchangeActionData,
  CardWithWild,
  ChooseGiverCardResponse,
  GameState,
  PlayerPosition,
  StandardRank,
} from "@/lib/types";

function invalidChoiceResult(reason: string, status = 400): ActionResult<ChooseGiverCardResponse> {
  return { status, body: { success: false, error: "Invalid giver card choice", reason } };
}

export async function chooseGiverCard(
  gameId: string,
  playerId: string,
  card: Card,
): Promise<ActionResult<ChooseGiverCardResponse | { error: string }>> {
  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return { status: 404, body: { error: "Game not found" } };
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return { status: 400, body: { error: "Game is not in progress" } };
  }
  if (!round || round.status !== "awaiting_giver_choice") {
    return { status: 400, body: { error: "Round is not awaiting a giver card choice" } };
  }
  if (!caller || caller.position === null) {
    return invalidChoiceResult("playerId is not a seated participant", 403);
  }
  const position = caller.position;

  const pending = round.game_state.pendingGiverChoice;
  if (!pending) {
    // Shouldn't happen — startNextRound always sets this alongside the
    // 'awaiting_giver_choice' status — but stay defensive rather than
    // crashing on a malformed round.
    console.error(`Round ${round.id} is 'awaiting_giver_choice' with no pendingGiverChoice`);
    return { status: 500, body: { error: "Round has no pending giver choice" } };
  }
  if (!pending.pendingPositions.includes(position)) {
    return invalidChoiceResult("you do not owe a giver card choice", 403);
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
    return invalidChoiceResult("card must be one of your own tied best cards");
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
    return { status: 500, body: { error: "Failed to submit giver card choice" } };
  }
  const recordedRound = recordResult.data?.[0];
  if (!recordedRound) {
    return { status: 409, body: { error: "the giver card choice was already submitted by another request" } };
  }
  await broadcastToGame(gameId, "round_updated", recordedRound);

  if (newPendingPositions.length > 0) {
    // Another giver still owes a choice — nothing further to resolve yet.
    return { status: 200, body: { success: true } };
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
): Promise<ActionResult<ChooseGiverCardResponse | { error: string }>> {
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
    return { status: 500, body: { error: "Failed to resolve the card exchange" } };
  }

  if (plan.needsChoice) {
    // RULES.md "Two-Team Lead": the two givers' resolved cards still tie in
    // rank — hand off to 1st place's own choice (choose-tribute), the same
    // transition end-hand makes for this case.
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
      return {
        status: 500,
        body: { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
      };
    }
    await broadcastToGame(gameId, "round_updated", updateResult.data[0]);
    return { status: 200, body: { success: true } };
  }

  // Fully resolved — apply the transfers and move on to 'card_exchange',
  // exactly like startNextRound's own resolved-transfer path. Also sets
  // leader_position now (RULES.md "Leader Selection": whoever gave up the
  // tribute card that went to 1st place) — the round isn't playable yet
  // (current_player_turn stays null), but exchange-cards needs this already
  // in place once every return is in.
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
    return {
      status: 500,
      body: { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
    };
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return { status: 409, body: { error: "the round was already advanced by another request" } };
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
    // Accepted gap (matches exchangeCards.ts's own note on a similar race):
    // a retry has to be triggered some other way, since resubmitting this
    // same choice would now 403 ("you do not owe a giver card choice")
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
    return {
      status: 500,
      body: { error: "Giver card choice recorded, but the round could not be advanced. Please retry." },
    };
  }

  await Promise.all([
    broadcastToGame(gameId, "round_updated", claimedRound),
    ...actionResults.map((r) => broadcastToGame(gameId, "game_action", r.data)),
  ]);

  return { status: 200, body: { success: true } };
}
