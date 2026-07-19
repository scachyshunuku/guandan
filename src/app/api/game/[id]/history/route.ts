import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mapGameActionRow, type GameActionRow } from "@/lib/db/mappers";
import { fetchGameRowById } from "@/lib/db/gameQueries";
import { unwrapSupabaseResult, withApiErrorHandling } from "@/lib/api/errorHandling";
import type { GameActionsResponse } from "@/lib/types";

// GET /api/game/[id]/history — complete action log for replay/audit
// (IMPLEMENTATION.md Task 3.4). Unlike the participant hand data returned by
// GET /api/game/[id], no redaction is needed here: every action type
// (card_played, pass, card_exchange, join, leave) reflects information
// RULES.md already treats as public once it happens ("All card exchanges
// are visible to all players").
export const GET = withApiErrorHandling<{ id: string }>(async (_request, { params }) => {
  const { id } = await params;

  const gameRow = unwrapSupabaseResult(await fetchGameRowById(id));
  if (!gameRow) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const actionRows = unwrapSupabaseResult(
    await supabaseAdmin
      .from("game_actions")
      .select("*")
      .eq("game_id", gameRow.id)
      .order("created_at", { ascending: true })
  ) as GameActionRow[] | null;

  const response: GameActionsResponse = {
    actions: (actionRows ?? []).map(mapGameActionRow),
  };

  return NextResponse.json(response);
});
