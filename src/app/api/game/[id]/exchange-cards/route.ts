// POST /api/game/[id]/exchange-cards — see ARCHITECTURE.md section 8 and
// IMPLEMENTATION.md Task 3.3. Handles only the player-selected "return" half
// of RULES.md "Card Exchange (After Each Round)" — the automatic "initial"
// half (best card, sender/recipient determined by finishing position) is
// already applied by end-hand/route.ts, which records it as 'initial'
// card_exchange game_actions. This route looks those up to find who owes a
// return to whom, rather than trusting a client-supplied pairing. Once every
// recipient of an initial card has returned one, it completes this round
// and deals the next.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getGameContext,
  getParticipants,
  isPlayerPosition,
  levelRankForGame,
  type GameRow,
  type GameRoundRow,
} from "@/lib/gameDb";
import { removeCardsFromHand } from "@/lib/cardUtils";
import { dealHands } from "@/lib/deck";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { GameActionRow } from "@/lib/db/mappers";
import type {
  CardExchangeActionData,
  CardWithWild,
  ExchangeCardsRequest,
  ExchangeCardsResponse,
  GameState,
  PlayerPosition,
} from "@/lib/types";

function invalidExchangeResponse(reason: string, status = 400) {
  return NextResponse.json(
    { success: false, error: "Invalid exchange", reason } satisfies ExchangeCardsResponse,
    { status },
  );
}

function asCardExchangeData(action: GameActionRow): CardExchangeActionData {
  return action.action_data as CardExchangeActionData;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<ExchangeCardsRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, position, cardToGive, type, recipientPosition } = parsed.body;
  if (!playerId || !isPlayerPosition(position) || !cardToGive || !isPlayerPosition(recipientPosition)) {
    return NextResponse.json(
      { error: "playerId, a valid position, cardToGive, and a valid recipientPosition are required" },
      { status: 400 },
    );
  }
  // The "initial" half is automatic (applied by end-hand), not something a
  // client submits — see this file's header comment.
  if (type !== "return") {
    return invalidExchangeResponse("only 'return' exchanges can be submitted; initial exchanges are automatic");
  }

  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return NextResponse.json({ error: "Game is not in progress" }, { status: 400 });
  }
  if (!round || round.status !== "card_exchange") {
    return NextResponse.json(
      { error: "Round is not in the card exchange phase" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null || caller.position !== position) {
    return invalidExchangeResponse("playerId does not match position", 403);
  }

  const actionRows = await getRoundCardExchangeActions(round.id);
  const initialActions = actionRows.filter((a) => asCardExchangeData(a).type === "initial");
  const returnActions = actionRows.filter((a) => asCardExchangeData(a).type === "return");

  // Who gave `position` a card in the initial exchange — that's who they
  // owe a return to, regardless of what `recipientPosition` the client sent
  // (validated against it below rather than trusted outright).
  const myInitial = initialActions.find((a) => asCardExchangeData(a).to === position);
  if (!myInitial) {
    return invalidExchangeResponse("you did not receive a card in the initial exchange");
  }
  const owedTo = asCardExchangeData(myInitial).from;
  if (recipientPosition !== owedTo) {
    return invalidExchangeResponse("recipientPosition does not match who gave you a card");
  }

  if (returnActions.some((a) => asCardExchangeData(a).from === position)) {
    // Normally a genuine duplicate submission (retry/double-click) — reject
    // it below. But once every owed return is already in, this player
    // re-submitting is also the *only* available trigger to retry a
    // finalization that previously failed partway: finalizeRoundAndDealNext
    // only ever runs inline with the last return's own request (see below),
    // so if that attempt errored, every returning player already has an
    // "already submitted" row on file and would otherwise have no way to
    // ever advance the round again.
    if (returnActions.length >= initialActions.length) {
      const outcome = await finalizeRoundAndDealNext(game, round);
      if (outcome === "error") {
        return NextResponse.json(
          { error: "The round could not be finalized. Please retry." },
          { status: 500 },
        );
      }
      const response: ExchangeCardsResponse = { success: true };
      return NextResponse.json(response);
    }
    // Not a compare-and-swap — a genuine double-submit race from the *same*
    // player (rapid retry/double-click) before all returns are in could
    // still let two return actions through for `position`. Accepted gap:
    // fixing it properly needs either a DB constraint or a claim step
    // neither of which exists for this table today, and the failure mode is
    // limited to that one player's own exchange being double-counted, not a
    // cross-player correctness issue.
    return invalidExchangeResponse("you have already submitted your return exchange", 409);
  }

  const newCallerHand = removeCardsFromHand(caller.hand, [cardToGive]);
  if (newCallerHand.length === caller.hand.length) {
    return invalidExchangeResponse("cardToGive is not in your hand");
  }

  const recipient = participants.find((p) => p.position === owedTo)!;
  const newRecipientHand = [...recipient.hand, cardToGive];
  // Captured now, before either write below: caller/recipient came straight
  // from getGameContext, not a defensive shallow copy, so reading
  // caller.hand/recipient.hand again after their own update below mutates
  // that same object would see the *new* hand, not the one a rollback needs.
  const originalCallerHand = caller.hand;
  const originalRecipientHand = recipient.hand;

  const actionData: CardExchangeActionData = { from: position, to: owedTo, card: cardToGive, type: "return" };
  const [callerUpdate, recipientUpdate, actionInsert] = await Promise.all([
    supabaseAdmin.from("game_participants").update({ hand: newCallerHand }).eq("id", caller.id),
    supabaseAdmin.from("game_participants").update({ hand: newRecipientHand }).eq("id", recipient.id),
    supabaseAdmin
      .from("game_actions")
      .insert({
        game_id: gameId,
        round_id: round.id,
        player_id: playerId,
        action_type: "card_exchange",
        action_data: actionData,
      })
      .select("*")
      .single(),
  ]);
  const failure = [callerUpdate, recipientUpdate, actionInsert].find((r) => r.error);
  if (failure) {
    console.error("Failed to persist return exchange after one of its writes succeeded; rolling back", failure.error);
    await Promise.all([
      supabaseAdmin.from("game_participants").update({ hand: originalCallerHand }).eq("id", caller.id),
      supabaseAdmin.from("game_participants").update({ hand: originalRecipientHand }).eq("id", recipient.id),
      // The action insert can succeed even when a sibling write in this
      // same Promise.all fails — leaving it in place would permanently
      // lock this player out via the "already submitted" check above (a
      // retry would find its own orphaned row and 409 forever), and in a
      // two-return round it would also count toward completion despite
      // this exchange never having actually gone through.
      ...(actionInsert.data
        ? [supabaseAdmin.from("game_actions").delete().eq("id", (actionInsert.data as { id: string }).id)]
        : []),
    ]);
    return NextResponse.json({ error: "Failed to submit return exchange" }, { status: 500 });
  }

  await broadcastToGame(gameId, "game_action", actionInsert.data);

  // Re-check completeness *after* this return has landed, not from the
  // pre-insert `returnActions` snapshot above — with two returns owed (a
  // 1-2/two-team-lead round), checking against the stale snapshot would let
  // two near-simultaneous submissions both conclude "not done yet" and
  // never advance the round. Whichever request's post-insert read is the
  // one that observes both returns present is the one that proceeds to
  // finalize; finalizeRoundAndDealNext's own compare-and-swap on the
  // round's status handles the case where both requests reach that point.
  const postInsertActions = await getRoundCardExchangeActions(round.id);
  const postReturnCount = postInsertActions.filter((a) => asCardExchangeData(a).type === "return").length;
  if (postReturnCount >= initialActions.length) {
    const outcome = await finalizeRoundAndDealNext(game, round);
    if (outcome === "error") {
      // This return itself is safely recorded above — but exchange-cards'
      // job also includes advancing the game once every return is in
      // (IMPLEMENTATION.md Task 3.3), and that part just failed. Surface it
      // rather than claiming full success; the round is left rolled back to
      // 'card_exchange' (see finalizeRoundAndDealNext), consistent state.
      return NextResponse.json(
        { error: "Return recorded, but the round could not be finalized. Please retry." },
        { status: 500 },
      );
    }
  }

  const response: ExchangeCardsResponse = { success: true };
  return NextResponse.json(response);
}

async function getRoundCardExchangeActions(roundId: string): Promise<GameActionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("game_actions")
    .select("*")
    .eq("round_id", roundId)
    .eq("action_type", "card_exchange");
  if (error) throw error;
  return (data ?? []) as GameActionRow[];
}

type FinalizeOutcome = "dealt" | "already_finalized" | "error";

// Completes the just-exchanged round and deals the next one, once every
// recipient of an initial card has returned one (RULES.md "End Hand /
// Level": "Reshuffle and deal 27 cards... Start next hand with 1st place
// player as leader"). The compare-and-swap on `status` means only one of
// however many requests conclude "all returns are in" actually proceeds
// past the claim below — the rest get "already_finalized", their own
// return already recorded regardless.
async function finalizeRoundAndDealNext(game: GameRow, round: GameRoundRow): Promise<FinalizeOutcome> {
  const roundCompleteResult = await supabaseAdmin
    .from("game_rounds")
    .update({ status: "completed" })
    .eq("id", round.id)
    .eq("status", "card_exchange")
    .select("*");
  if (roundCompleteResult.error) {
    console.error("Failed to complete round after all returns submitted", roundCompleteResult.error);
    return "error";
  }
  if (!roundCompleteResult.data?.length) {
    return "already_finalized";
  }

  const finishingPositions = round.finishing_positions ?? [];
  const leaderPosition = finishingPositions.indexOf(1) as PlayerPosition;

  // Fetched fresh here, not reused from the caller's earlier read — this
  // request's own return (and, in a two-return round, a concurrent
  // request's return) has already landed by this point, and dealing needs
  // each seat's *current* hand as the rollback fallback below, not a
  // pre-exchange snapshot.
  const freshParticipants = await getParticipants(game.id);
  const seated = new Map<PlayerPosition, { id: string; hand: CardWithWild[] }>();
  for (const p of freshParticipants) {
    if (p.position !== null) seated.set(p.position, p);
  }

  const newGameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  const newRoundInsert = await supabaseAdmin
    .from("game_rounds")
    .insert({
      game_id: game.id,
      round_number: round.round_number + 1,
      game_state: newGameState,
      leader_position: leaderPosition,
      current_player_turn: leaderPosition,
    })
    .select("*")
    .single();
  if (newRoundInsert.error || !newRoundInsert.data) {
    console.error("Failed to create next round after card exchange completed; rolling back", newRoundInsert.error);
    await revertRoundToCardExchange(round.id);
    return "error";
  }

  const hands = dealHands(levelRankForGame(game));
  const dealWrites = ([0, 1, 2, 3] as const).map((position) => {
    const participant = seated.get(position)!;
    return { id: participant.id, originalHand: participant.hand, newHand: hands[position] };
  });
  const dealResults = await Promise.all(
    dealWrites.map((w) => supabaseAdmin.from("game_participants").update({ hand: w.newHand }).eq("id", w.id)),
  );
  const dealFailure = dealResults.find((r) => r.error);
  if (dealFailure) {
    console.error("Failed to deal hands for the new round; rolling back", dealFailure.error);
    await Promise.all([
      supabaseAdmin.from("game_rounds").delete().eq("id", newRoundInsert.data.id),
      revertRoundToCardExchange(round.id),
      ...dealWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
      ),
    ]);
    return "error";
  }

  await broadcastToGame(game.id, "round_updated", newRoundInsert.data);
  return "dealt";
}

async function revertRoundToCardExchange(roundId: string) {
  const { error } = await supabaseAdmin
    .from("game_rounds")
    .update({ status: "card_exchange" })
    .eq("id", roundId)
    .eq("status", "completed");
  if (error) {
    console.error("Failed to roll back round status after failed round finalization", error);
  }
}
