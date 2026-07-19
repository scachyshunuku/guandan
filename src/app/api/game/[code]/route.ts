import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  mapGameActionRow,
  mapGameParticipantRow,
  mapGameRoundRow,
  mapGameRow,
  type GameActionRow,
  type GameParticipantRow,
  type GameRoundRow,
} from "@/lib/db/mappers";
import { fetchGameRowByCode } from "@/lib/db/gameQueries";
import { buildGameStateResponse } from "@/lib/gameStateResponse";

// GET /api/game/[code]?playerId=... — current game state (IMPLEMENTATION.md
// Task 3.4). `code` is the shareable game code from the URL, not the games.id
// UUID (ARCHITECTURE.md section 2 "Game Code"). `playerId` scopes which
// participant's hand is revealed; every other participant's hand is redacted
// since game_participants isn't publicly readable (see migration RLS notes).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const requestingPlayerId = request.nextUrl.searchParams.get("playerId");

  const { data: gameRow, error: gameError } = await fetchGameRowByCode(code);

  if (gameError) {
    return NextResponse.json({ error: gameError.message }, { status: 500 });
  }
  if (!gameRow) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const [roundResult, participantsResult] = await Promise.all([
    supabaseAdmin
      .from("game_rounds")
      .select("*")
      .eq("game_id", gameRow.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle<GameRoundRow>(),
    supabaseAdmin.from("game_participants").select("*").eq("game_id", gameRow.id),
  ]);

  if (roundResult.error) {
    return NextResponse.json({ error: roundResult.error.message }, { status: 500 });
  }
  if (participantsResult.error) {
    return NextResponse.json({ error: participantsResult.error.message }, { status: 500 });
  }

  const game = mapGameRow(gameRow);
  const round = roundResult.data ? mapGameRoundRow(roundResult.data) : null;
  const participants = ((participantsResult.data as GameParticipantRow[] | null) ?? []).map(
    mapGameParticipantRow
  );

  let roundActions: ReturnType<typeof mapGameActionRow>[] = [];
  if (round) {
    const { data: actionRows, error: actionsError } = await supabaseAdmin
      .from("game_actions")
      .select("*")
      .eq("round_id", round.id)
      .order("created_at", { ascending: true });

    if (actionsError) {
      return NextResponse.json({ error: actionsError.message }, { status: 500 });
    }
    roundActions = ((actionRows as GameActionRow[] | null) ?? []).map(mapGameActionRow);
  }

  return NextResponse.json(
    buildGameStateResponse(game, round, participants, requestingPlayerId, roundActions)
  );
}
