import { NextResponse } from "next/server";
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
import { fetchGameRowById } from "@/lib/db/gameQueries";
import { unwrapSupabaseResult, withApiErrorHandling } from "@/lib/api/errorHandling";
import { buildGameStateResponse } from "@/lib/gameStateResponse";

// GET /api/game/[id]?playerId=... — current game state (IMPLEMENTATION.md
// Task 3.4). `id` is the game's UUID, which doubles as its shareable code
// (ARCHITECTURE.md section 2 "Game Code" — there's no separate code column).
// `playerId` scopes which participant's hand is revealed; every other
// participant's hand is redacted since game_participants isn't publicly
// readable (see migration RLS notes).
export const GET = withApiErrorHandling<{ id: string }>(async (request, { params }) => {
  const { id } = await params;
  const requestingPlayerId = request.nextUrl.searchParams.get("playerId");

  const gameRow = unwrapSupabaseResult(await fetchGameRowById(id));
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

  const roundRow = unwrapSupabaseResult(roundResult);
  const participantRows = unwrapSupabaseResult(participantsResult) as GameParticipantRow[] | null;

  const game = mapGameRow(gameRow);
  const round = roundRow ? mapGameRoundRow(roundRow) : null;
  const participants = (participantRows ?? []).map(mapGameParticipantRow);

  let roundActions: ReturnType<typeof mapGameActionRow>[] = [];
  if (round) {
    const actionRows = unwrapSupabaseResult(
      await supabaseAdmin
        .from("game_actions")
        .select("*")
        .eq("round_id", round.id)
        .order("created_at", { ascending: true })
    ) as GameActionRow[] | null;
    roundActions = (actionRows ?? []).map(mapGameActionRow);
  }

  return NextResponse.json(
    buildGameStateResponse(game, round, participants, requestingPlayerId, roundActions)
  );
});
