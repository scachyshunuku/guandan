// POST /api/game/[id]/hand-order — Task 5.1a (IMPLEMENTATION.md): persists a
// player's dragged hand arrangement server-side so it survives refresh/
// reconnect from any device, not just the browser that made it (the
// same-device case is already covered client-side by localStorage - see
// components/game/PlayerHand.tsx). `order` is stored as-is and never
// validated against the caller's actual `hand` column: it's purely a
// display ordering (see GameParticipant.handOrder's doc comment in
// types.ts), reconciled against the real hand on every read, so there's no
// game-state invariant for the server to protect here - unlike play-cards/
// pass, this never touches game_rounds and has no turn/round-status
// dependency, so it doesn't go through gameDb.ts's resolveTurn/
// getGameContext (built for exactly that shared turn-taking logic).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGame } from "@/lib/gameDb";
import { parseJsonBody } from "@/lib/http";
import type { HandOrderRequest, HandOrderResponse } from "@/lib/types";

// Generous but not unbounded - a real hand never exceeds 27 cards (RULES.md
// "Dealing"), so this is purely a sanity cap against a malformed/abusive
// payload, not a game-rule limit enforced here.
const MAX_ORDER_LENGTH = 200;
const MAX_KEY_LENGTH = 32;

function isValidOrder(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ORDER_LENGTH &&
    value.every((key) => typeof key === "string" && key.length <= MAX_KEY_LENGTH)
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<HandOrderRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId, order } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }
  if (!isValidOrder(order)) {
    return NextResponse.json({ error: "order must be an array of short strings" }, { status: 400 });
  }

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const { data: caller, error: callerError } = await supabaseAdmin
    .from("game_participants")
    .select("id")
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (callerError) {
    console.error("Failed to look up participant for hand-order update", callerError);
    return NextResponse.json({ error: "Failed to save hand order" }, { status: 500 });
  }
  if (!caller) {
    return NextResponse.json({ error: "playerId is not a participant in this game" }, { status: 403 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("game_participants")
    .update({ hand_order: order })
    .eq("id", caller.id);
  if (updateError) {
    console.error("Failed to save hand order", updateError);
    return NextResponse.json({ error: "Failed to save hand order" }, { status: 500 });
  }

  // Not broadcast, unlike heartbeat/join's participant updates - no other
  // client has any use for another player's display-only card ordering (see
  // GameParticipant.handOrder's doc comment on why it'd also need the same
  // redaction those broadcasts give `hand` if it ever were broadcast).
  const response: HandOrderResponse = { success: true };
  return NextResponse.json(response);
}
