import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mapGameActionRow, type GameActionRow } from "@/lib/db/mappers";
import { fetchGameRowByCode } from "@/lib/db/gameQueries";
import type { GameActionsResponse } from "@/lib/types";

// GET /api/game/[code]/history — complete action log for replay/audit
// (IMPLEMENTATION.md Task 3.4). Unlike the participant hand data returned by
// GET /api/game/[code], no redaction is needed here: every action type
// (card_played, pass, card_exchange, join, leave) reflects information
// RULES.md already treats as public once it happens ("All card exchanges
// are visible to all players").
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const { data: gameRow, error: gameError } = await fetchGameRowByCode(code);

  if (gameError) {
    return NextResponse.json({ error: gameError.message }, { status: 500 });
  }
  if (!gameRow) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const { data: actionRows, error: actionsError } = await supabaseAdmin
    .from("game_actions")
    .select("*")
    .eq("game_id", gameRow.id)
    .order("created_at", { ascending: true });

  if (actionsError) {
    return NextResponse.json({ error: actionsError.message }, { status: 500 });
  }

  const response: GameActionsResponse = {
    actions: ((actionRows as GameActionRow[] | null) ?? []).map(mapGameActionRow),
  };

  return NextResponse.json(response);
}
