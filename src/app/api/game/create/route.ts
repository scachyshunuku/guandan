// POST /api/game/create — see ARCHITECTURE.md section 8 and
// IMPLEMENTATION.md Task 3.1. Only creates the `games` row; no participant is
// added and no round exists yet (that's /join and /start, respectively —
// start/route.ts inserts round 1 itself once the game actually begins,
// mirroring startNextRound.ts's pattern for every round after it).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CreateGameResponse } from "@/lib/types";

export async function POST() {
  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .insert({})
    .select("id")
    .single();

  if (gameError || !game) {
    console.error("Failed to create game", gameError);
    return NextResponse.json(
      { error: "Failed to create game" },
      { status: 500 },
    );
  }

  const response: CreateGameResponse = { gameId: game.id };
  return NextResponse.json(response, { status: 201 });
}
