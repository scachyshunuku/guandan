// Play a combination of cards — see ARCHITECTURE.md section 7 ("Play
// Combination") and IMPLEMENTATION.md Task 3.2. Validates the play against
// the caller's hand and the current trick (Task 2.3's canPlayCards),
// persists it, and advances turn/trick state. Called by both
// play-cards/route.ts (an HTTP request from a human) and the bot runner (an
// in-process call from a bot) — this is the single place that logic lives,
// so both run identically.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { levelRankForGame, resolveTurn, type ActiveRoundRow } from "@/lib/gameDb";
import { compareCards, removeCardsFromHand } from "@/lib/cardUtils";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import { canPlayCards } from "@/lib/gameRules/validation";
import { detectRoundEnd } from "@/lib/gameRules/scoring";
import { advanceTrick, toGameState } from "@/lib/gameRules/turnAdvance";
import type { ActionResult } from "./actionResult";
import type {
  CardPlayedActionData,
  CardWithWild,
  GameState,
  PlayCardsResponse,
  PlayerFinishedActionData,
  PlayerPosition,
  TrickEndActionData,
  TrickEntry,
} from "@/lib/types";

function invalidPlayResult(reason: string, status = 400): ActionResult<PlayCardsResponse> {
  return { status, body: { success: false, error: "Invalid play", reason } };
}

export async function playCards(
  gameId: string,
  playerId: string,
  cards: CardWithWild[],
): Promise<ActionResult<PlayCardsResponse | { error: string }>> {
  const turn = await resolveTurn(gameId, playerId);
  if (!turn.ok) {
    return invalidPlayResult(turn.error, turn.status);
  }
  const { game, round, caller, position } = turn;

  const levelRank = levelRankForGame(game);
  const result = canPlayCards(cards, caller.hand, round.game_state.currentTrick, levelRank);
  if (!result.valid) {
    return invalidPlayResult(result.reason ?? "invalid play");
  }

  // Store/display plays sorted smallest-to-largest, regardless of the order
  // the player selected/clicked them in — RULES.md never assigns meaning to
  // play order, so normalizing it here (after validation, which is already
  // order-independent — see combinations.ts) keeps the trick, game_actions
  // history, and every renderer of either in a consistent order for free.
  const sortedCards = [...cards].sort((a, b) => compareCards(a, b, levelRank));

  // Captured now, before any write — `caller` is a reference to live
  // participant state (via resolveTurn/getParticipants), so reading
  // `caller.hand` again after the hand update below would see the
  // already-mutated value, not the pre-play hand a rollback needs.
  const originalHand = caller.hand;
  const remainingHand = removeCardsFromHand(originalHand, sortedCards);
  const handEnded = remainingHand.length === 0;

  // A player going out takes no further turns (RULES.md), but the round
  // itself continues with whoever's still active — it doesn't freeze just
  // because one player finished. `newFinishOrder` feeds both this trick's
  // completion check (advanceTrick skips finished positions) and the
  // round-end check below.
  const newFinishOrder = handEnded ? [...round.game_state.finishOrder, position] : round.game_state.finishOrder;

  const entry: TrickEntry = { position, play: sortedCards };
  const advanced = advanceTrick(
    round.game_state.currentTrick,
    entry,
    newFinishOrder,
    round.leader_position,
    round.game_state.trickCount,
  );

  // The round ends once its outcome is fully determined (three finishers,
  // or a 1-2 finish — RULES.md "Round End"), not merely when someone goes
  // out. Once that happens, halt turn advancement here rather than handing
  // play to anyone else — determining the exact finishing-position array and
  // moving to card exchange is Task 3.3's end-hand endpoint, not this
  // function's. detectRoundEnd only needs consulting when this play grew
  // finishOrder; it can't newly conclude the round otherwise.
  const roundEnded = handEnded && detectRoundEnd(newFinishOrder) !== null;
  const newCurrentPlayerTurn = roundEnded ? null : advanced.currentPlayerTurn;
  const newGameState: GameState = toGameState(advanced, newFinishOrder);

  // Compare-and-swap on current_player_turn: if another request already
  // resolved this same turn (a double-submit, or two racing requests that
  // both read the round before either wrote), this update matches zero rows
  // instead of clobbering that request's write.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("game_rounds")
    .update({
      game_state: newGameState,
      leader_position: advanced.leaderPosition,
      current_player_turn: newCurrentPlayerTurn,
    })
    .eq("id", round.id)
    .eq("current_player_turn", position)
    .select("*");
  if (claimError) {
    console.error("Failed to claim play-cards turn", claimError);
    return { status: 500, body: { error: "Failed to play cards" } };
  }
  if (!claimed || claimed.length === 0) {
    return invalidPlayResult("this turn was already resolved by another request", 409);
  }

  const actionData: CardPlayedActionData = { cards: sortedCards, position };
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
    return { status: 500, body: { error: "Failed to play cards" } };
  }

  // If this play resolved the trick, log a trick_end entry too (Task 6.3's
  // "who won" audit trail — see GameHistory.tsx). Best-effort, like the
  // broadcasts below: the play itself already succeeded and is already
  // persisted, so a failure here shouldn't roll any of that back, only skip
  // this supplementary log entry.
  let trickEndActionRow: Record<string, unknown> | null = null;
  if (advanced.trickWinner !== null) {
    const trickEndActionData: TrickEndActionData = { winnerPosition: advanced.trickWinner };
    const { data, error } = await supabaseAdmin
      .from("game_actions")
      .insert({
        game_id: gameId,
        round_id: round.id,
        player_id: playerId,
        action_type: "trick_end",
        action_data: trickEndActionData,
      })
      .select("*")
      .single();
    if (error) {
      console.error("Failed to log trick_end game_action", error);
    } else {
      trickEndActionRow = data;
    }
  }

  // If this play emptied the caller's hand, log a player_finished entry too
  // (going out is worth announcing on its own, independent of whether it also
  // happened to resolve the trick or end the round). Best-effort, same as
  // trick_end above.
  let playerFinishedActionRow: Record<string, unknown> | null = null;
  if (handEnded) {
    const playerFinishedActionData: PlayerFinishedActionData = {
      position,
      place: (newFinishOrder.indexOf(position) + 1) as PlayerFinishedActionData["place"],
    };
    const { data, error } = await supabaseAdmin
      .from("game_actions")
      .insert({
        game_id: gameId,
        round_id: round.id,
        player_id: playerId,
        action_type: "player_finished",
        action_data: playerFinishedActionData,
      })
      .select("*")
      .single();
    if (error) {
      console.error("Failed to log player_finished game_action", error);
    } else {
      playerFinishedActionRow = data;
    }
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
    ...(trickEndActionRow ? [broadcastToGame(gameId, "game_action", trickEndActionRow)] : []),
    ...(playerFinishedActionRow ? [broadcastToGame(gameId, "game_action", playerFinishedActionRow)] : []),
  ]);

  return { status: 200, body: { success: true } };
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
// ended the round, and `current_player_turn: null` can never match any
// future request's (always 0-3) `position` in resolveTurn's turn check —
// so nothing else can have claimed past it through this route.
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
