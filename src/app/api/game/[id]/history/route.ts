import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mapGameActionRow, type GameActionRow } from "@/lib/db/mappers";
import { unwrapSupabaseResult, withApiErrorHandling } from "@/lib/api/errorHandling";
import type { GameActionsResponse } from "@/lib/types";

// GET /api/game/[id]/history
//
// Takes a game UUID/shareable code in `id`. Returns a GameActionsResponse
// (`{ actions }`) containing every action recorded for that game, ordered by
// creation time. A game with no recorded actions returns an empty list.
//
// Used for full-game replay and audit views. Unlike the current-state endpoint,
// this contains the complete action log rather than only the current round.
// No action data is redacted: card plays, exchanges, joins, and leaves are
// public once they occur under the game rules.
export const GET = withApiErrorHandling<{ id: string }>(async (_request, { params }) => {
  const { id } = await params;

  const actionRows = unwrapSupabaseResult(
    await supabaseAdmin
      .from("game_actions")
      .select("*")
      .eq("game_id", id)
      .order("created_at", { ascending: true })
  ) as GameActionRow[] | null;

  const response: GameActionsResponse = {
    actions: (actionRows ?? []).map(mapGameActionRow),
  };

  return NextResponse.json(response);
});
