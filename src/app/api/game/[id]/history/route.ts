import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mapGameActionRow, type GameActionRow } from "@/lib/db/mappers";
import { unwrapSupabaseResult, withApiErrorHandling } from "@/lib/api/errorHandling";
import { isValidUuid } from "@/lib/http";
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

  // A malformed id (not a syntactically valid UUID) can never match a row,
  // same as a well-formed-but-nonexistent one — this route doesn't check
  // game existence either way, it just returns whatever actions match.
  // Skipping the query for a malformed id avoids a Postgres 22P02 error
  // that would otherwise surface as an unhandled exception (see
  // isValidUuid's doc comment in lib/http.ts).
  const actionRows = isValidUuid(id)
    ? (unwrapSupabaseResult(
        await supabaseAdmin
          .from("game_actions")
          .select("*")
          .eq("game_id", id)
          .order("created_at", { ascending: true })
      ) as GameActionRow[] | null)
    : null;

  const response: GameActionsResponse = {
    actions: (actionRows ?? []).map(mapGameActionRow),
  };

  return NextResponse.json(response);
});
