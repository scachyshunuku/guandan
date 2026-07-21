// POST /api/game/[id]/play-cards — see ARCHITECTURE.md section 7 ("Play
// Combination") and IMPLEMENTATION.md Task 3.2. Validates the play against
// the caller's hand and the current trick (Task 2.3's canPlayCards),
// persists it, and advances turn/trick state.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isPlayerPosition,
  levelRankForGame,
  resolveTurn,
  type ActiveRoundRow,
} from "@/lib/gameDb";
import { removeCardsFromHand } from "@/lib/cardUtils";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import { canPlayCards } from "@/lib/gameRules/validation";
import { advanceTrick } from "@/lib/gameRules/scoring";
import type {
  CardPlayedActionData,
  CardWithWild,
  PlayCardsRequest,
  PlayCardsResponse,
  PlayerPosition,
} from "@/lib/types";

function invalidPlayResponse(reason: string, status = 400) {
  return NextResponse.json(
    { success: false, error: "Invalid play", reason } satisfies PlayCardsResponse,
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<PlayCardsRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { cards, playerId, position } = parsed.body;
  if (!cards || !playerId || !isPlayerPosition(position)) {
    return NextResponse.json(
      { error: "cards, playerId, and a valid position (0-3) are required" },
      { status: 400 },
    );
  }

  const turn = await resolveTurn(gameId, playerId, position);
  if (!turn.ok) {
    return invalidPlayResponse(turn.error, turn.status);
  }
  const { game, round, caller } = turn;

  const levelRank = levelRankForGame(game);
  const result = canPlayCards(cards, caller.hand, round.game_state.currentTrick, levelRank);
  if (!result.valid) {
    return invalidPlayResponse(result.reason ?? "invalid play");
  }

  // Captured now, before any write — `caller` is a reference to live
  // participant state (via resolveTurn/getParticipants), so reading
  // `caller.hand` again after the hand update below would see the
  // already-mutated value, not the pre-play hand a rollback needs.
  const originalHand = caller.hand;
  const remainingHand = removeCardsFromHand(originalHand, cards);
  const handEnded = remainingHand.length === 0;

  const advanced = advanceTrick(
    round.game_state.currentTrick,
    cards,
    round.leader_position,
    position,
    round.game_state.trickCount,
  );
  // A player going out ends their participation in the hand; halt turn
  // advancement here (even if they also just won the trick) rather than
  // handing play to someone else out of turn. Determining finishing
  // positions and resuming the hand (or moving to card exchange) once
  // everyone's had a chance to finish this trick is Task 3.3's end-hand
  // endpoint, not this route's.
  const newCurrentPlayerTurn = handEnded ? null : advanced.currentPlayerTurn;

  // Compare-and-swap on current_player_turn: if another request already
  // resolved this same turn (a double-submit, or two racing requests that
  // both read the round before either wrote), this update matches zero rows
  // instead of clobbering that request's write.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("game_rounds")
    .update({
      game_state: advanced.gameState,
      leader_position: advanced.leaderPosition,
      current_player_turn: newCurrentPlayerTurn,
    })
    .eq("id", round.id)
    .eq("current_player_turn", position)
    .select("*");
  if (claimError) {
    console.error("Failed to claim play-cards turn", claimError);
    return NextResponse.json({ error: "Failed to play cards" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return invalidPlayResponse("this turn was already resolved by another request", 409);
  }

  const actionData: CardPlayedActionData = { cards, position };
  const [handUpdateResult, actionInsertResult] = await Promise.all([
    supabaseAdmin
      .from("game_participants")
      .update({ hand: remainingHand })
      .eq("id", caller.id),
    supabaseAdmin
      .from("game_actions")
      .insert({
        game_id: gameId,
        round_id: round.id,
        player_id: playerId,
        action_type: "card_played",
        action_data: actionData,
      })
      .select("*")
      .single(),
  ]);
  const failure = [handUpdateResult, actionInsertResult].find((r) => r.error);
  if (failure) {
    console.error(
      "Failed to persist play-cards side effects after claiming the turn; rolling back",
      failure.error,
    );
    await rollbackClaim(round, newCurrentPlayerTurn, caller.id, originalHand);
    return NextResponse.json({ error: "Failed to play cards" }, { status: 500 });
  }

  // Broadcast the new round state and the play itself so other players' and
  // spectators' useGameRealtimeSync picks it up in real time (see
  // ARCHITECTURE.md section 10, and start/route.ts's identical pattern).
  // Best-effort: broadcastToGame logs and swallows send failures rather than
  // throwing, so a dropped broadcast doesn't fail a play that already
  // succeeded — a client that misses it still catches up on refresh/rejoin.
  await Promise.all([
    broadcastToGame(gameId, "round_updated", claimed[0]),
    broadcastToGame(gameId, "game_action", actionInsertResult.data),
  ]);

  const response: PlayCardsResponse = { success: true };
  return NextResponse.json(response);
}

// Undoes a claimed turn's downstream writes (hand update, action log) after
// one of them fails partway, so a retry sees a clean, consistent round
// rather than one stuck with an advanced turn but no recorded play.
//
// The round revert is conditional on `claimedCurrentPlayerTurn`, *not*
// unconditional-by-id — a legitimate next player could already have read
// our successful claim, acted on it, and advanced the turn again before this
// rollback runs. An unconditional revert would stomp that committed play.
// The one case where an unconditional-by-id revert back to null actually is
// safe: `claimedCurrentPlayerTurn === null` only happens when this play
// emptied the caller's hand, and `current_player_turn: null` can never match
// any future request's (always 0-3) `position` in resolveTurn's turn check
// — so nothing else can have claimed past it through this route.
//
// The hand revert, by contrast, is always safe unconditional-by-id (matching
// start/route.ts's rollback of per-seat hands): it only ever touches this
// caller's own participant row, which nothing else can write to until the
// round cycles all the way back to their turn again.
async function rollbackClaim(
  round: ActiveRoundRow,
  claimedCurrentPlayerTurn: PlayerPosition | null,
  callerId: string,
  originalHand: CardWithWild[],
) {
  let roundRollback = supabaseAdmin
    .from("game_rounds")
    .update({
      game_state: round.game_state,
      leader_position: round.leader_position,
      current_player_turn: round.current_player_turn,
    })
    .eq("id", round.id);
  if (claimedCurrentPlayerTurn !== null) {
    roundRollback = roundRollback.eq("current_player_turn", claimedCurrentPlayerTurn);
  }

  const [roundResult, handResult] = await Promise.all([
    roundRollback,
    supabaseAdmin.from("game_participants").update({ hand: originalHand }).eq("id", callerId),
  ]);
  if (roundResult.error) {
    console.error("Failed to roll back game_rounds after failed play-cards write", roundResult.error);
  }
  if (handResult.error) {
    console.error("Failed to roll back participant hand after failed play-cards write", handResult.error);
  }
}
