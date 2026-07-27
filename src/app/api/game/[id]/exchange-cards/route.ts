// POST /api/game/[id]/exchange-cards — see ARCHITECTURE.md section 8 and
// IMPLEMENTATION.md Task 3.3. Handles only the player-selected "return" half
// of RULES.md "Card Exchange (After Each Round)" — the automatic "initial"
// half (best card, sender/recipient determined by finishing position) is
// already applied by startNextRound (lib/startNextRound.ts, called from
// end-hand/route.ts), which records it as 'initial' card_exchange
// game_actions. This route looks those up to find who owes a return to
// whom, rather than trusting a client-supplied pairing. Once every recipient
// of an initial card has returned one, it activates this round — its cards
// were already dealt, and its leader_position already set, back when
// startNextRound created it, so there's nothing left to deal here.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGameContext, type GameRow, type GameRoundRow } from "@/lib/gameDb";
import { removeCardsFromHand } from "@/lib/cardUtils";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { GameActionRow } from "@/lib/db/mappers";
import type { CardExchangeActionData, ExchangeCardsRequest, ExchangeCardsResponse } from "@/lib/types";

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
  const { playerId, cardToGive } = parsed.body;
  if (!playerId || !cardToGive) {
    return NextResponse.json(
      { error: "playerId and cardToGive are required" },
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
  if (!round || round.status !== "card_exchange") {
    return NextResponse.json(
      { error: "Round is not in the card exchange phase" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null) {
    return invalidExchangeResponse("playerId is not a seated participant", 403);
  }
  const position = caller.position;

  const actionRows = await getRoundCardExchangeActions(round.id);
  const initialActions = actionRows.filter((a) => asCardExchangeData(a).type === "initial");
  const returnActions = actionRows.filter((a) => asCardExchangeData(a).type === "return");

  // Who gave `position` a card in the initial exchange — that's who they
  // owe a return to. No client-submitted recipientPosition to cross-check
  // against: this is the only source for who the return goes to.
  const myInitial = initialActions.find((a) => asCardExchangeData(a).to === position);
  if (!myInitial) {
    return invalidExchangeResponse("you did not receive a card in the initial exchange");
  }
  const owedTo = asCardExchangeData(myInitial).from;

  if (returnActions.some((a) => asCardExchangeData(a).from === position)) {
    // Normally a genuine duplicate submission (retry/double-click) — reject
    // it below. But once every owed return is already in, this player
    // re-submitting is also the *only* available trigger to retry a
    // finalization that previously failed partway: finalizeExchangeAndStartRound
    // only ever runs inline with the last return's own request (see below),
    // so if that attempt errored, every returning player already has an
    // "already submitted" row on file and would otherwise have no way to
    // ever advance the round again.
    if (returnActions.length >= initialActions.length) {
      const outcome = await finalizeExchangeAndStartRound(game, round);
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
  // finalize; finalizeExchangeAndStartRound's own compare-and-swap on the
  // round's status handles the case where both requests reach that point.
  const postInsertActions = await getRoundCardExchangeActions(round.id);
  const postReturnCount = postInsertActions.filter((a) => asCardExchangeData(a).type === "return").length;
  if (postReturnCount >= initialActions.length) {
    const outcome = await finalizeExchangeAndStartRound(game, round);
    if (outcome === "error") {
      // This return itself is safely recorded above — but exchange-cards'
      // job also includes advancing the game once every return is in
      // (IMPLEMENTATION.md Task 3.3), and that part just failed. Surface it
      // rather than claiming full success; the round is left as-is
      // ('card_exchange', not yet activated) — a retry can pick this up
      // again since the return itself is already durably recorded.
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

type FinalizeOutcome = "started" | "already_finalized" | "error";

// Activates the already-dealt round once every recipient of an initial card
// has returned one — its cards and its leader_position (RULES.md "Leader
// Selection": whoever gave up the tribute card that went to 1st place) were
// already set when startNextRound (or choose-giver-card/choose-tribute, for
// a tie) created/advanced it, so there's nothing left to deal or derive
// here, just a single atomic status flip. The compare-and-swap on `status`
// means only one of however many requests conclude "all returns are in"
// actually proceeds past this update — the rest get "already_finalized",
// their own return already recorded regardless. No rollback needed on
// failure: this is the round's only write, so a failed update simply leaves
// it exactly as it was ('card_exchange'), ready for a retry.
async function finalizeExchangeAndStartRound(game: GameRow, round: GameRoundRow): Promise<FinalizeOutcome> {
  const activateResult = await supabaseAdmin
    .from("game_rounds")
    .update({ status: "in_progress", current_player_turn: round.leader_position })
    .eq("id", round.id)
    .eq("status", "card_exchange")
    .select("*");
  if (activateResult.error) {
    console.error("Failed to activate round after all returns submitted", activateResult.error);
    return "error";
  }
  if (!activateResult.data?.length) {
    return "already_finalized";
  }

  await broadcastToGame(game.id, "round_updated", activateResult.data[0]);
  return "started";
}
