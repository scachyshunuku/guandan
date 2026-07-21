// POST /api/game/[id]/pass — see ARCHITECTURE.md section 7 ("Pass") and
// IMPLEMENTATION.md Task 3.2. Records a pass, and if that completes the
// trick's one rotation (see types.ts's CurrentTrick doc comment), resolves
// the trick and hands the lead to its winner.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isPlayerPosition, resolveTurn, type ActiveRoundRow } from "@/lib/gameDb";
import { parseJsonBody } from "@/lib/http";
import { PASS } from "@/lib/types";
import type { PassRequest, PassResponse, PlayerPosition } from "@/lib/types";
import { advanceTrick } from "@/lib/gameRules/scoring";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<PassRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, position } = parsed.body;
  if (!playerId || !isPlayerPosition(position)) {
    return NextResponse.json(
      { error: "playerId and a valid position (0-3) are required" },
      { status: 400 },
    );
  }

  const turn = await resolveTurn(gameId, playerId, position);
  if (!turn.ok) {
    return NextResponse.json({ error: turn.error }, { status: turn.status });
  }
  const { round } = turn;

  // Leading (an empty trick) has nothing to beat, so there's no pass option
  // (RULES.md "When Leading").
  if (round.game_state.currentTrick.length === 0) {
    return NextResponse.json(
      { error: "cannot pass while leading" },
      { status: 400 },
    );
  }

  const advanced = advanceTrick(
    round.game_state.currentTrick,
    PASS,
    round.leader_position,
    position,
    round.game_state.trickCount,
  );

  // Compare-and-swap on current_player_turn — see play-cards/route.ts for
  // why this guards against a double-submit or two racing requests.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("game_rounds")
    .update({
      game_state: advanced.gameState,
      leader_position: advanced.leaderPosition,
      current_player_turn: advanced.currentPlayerTurn,
    })
    .eq("id", round.id)
    .eq("current_player_turn", position)
    .select("id");
  if (claimError) {
    console.error("Failed to claim pass turn", claimError);
    return NextResponse.json({ error: "Failed to pass" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "this turn was already resolved by another request" },
      { status: 409 },
    );
  }

  const { error: actionError } = await supabaseAdmin.from("game_actions").insert({
    game_id: gameId,
    round_id: round.id,
    player_id: playerId,
    action_type: "pass",
    action_data: {},
  });
  if (actionError) {
    console.error("Failed to log pass game_action after claiming the turn; rolling back", actionError);
    await rollbackRoundClaim(round, advanced.currentPlayerTurn);
    return NextResponse.json({ error: "Failed to pass" }, { status: 500 });
  }

  const response: PassResponse = { success: true };
  return NextResponse.json(response);
}

// Undoes a claimed turn's round update after the action-log write fails.
// Conditional on `claimedCurrentPlayerTurn` (never null for pass — unlike
// play-cards, a pass can never empty a hand), *not* unconditional-by-id: a
// legitimate next player could already have read our successful claim,
// acted on it, and advanced the turn again before this rollback runs. See
// play-cards/route.ts's rollbackClaim for the full reasoning.
async function rollbackRoundClaim(round: ActiveRoundRow, claimedCurrentPlayerTurn: PlayerPosition) {
  const { error } = await supabaseAdmin
    .from("game_rounds")
    .update({
      game_state: round.game_state,
      leader_position: round.leader_position,
      current_player_turn: round.current_player_turn,
    })
    .eq("id", round.id)
    .eq("current_player_turn", claimedCurrentPlayerTurn);
  if (error) {
    console.error("Failed to roll back game_rounds after failed pass write", error);
  }
}
