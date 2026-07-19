// POST /api/game/create — see ARCHITECTURE.md section 8 and
// IMPLEMENTATION.md Task 3.1. Only creates the `games` row and an empty
// round 1; no participant is added and no cards are dealt here (that's
// /join and /start, respectively).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CreateGameResponse, GameState } from "@/lib/types";

const INITIAL_GAME_STATE: GameState = { currentTrick: [], trickCount: 0 };

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

  const { error: roundError } = await supabaseAdmin
    .from("game_rounds")
    .insert({
      game_id: game.id,
      round_number: 1,
      game_state: INITIAL_GAME_STATE,
    });

  if (roundError) {
    console.error("Failed to initialize game round", roundError);
    // Don't leave a game behind with no round to play in.
    const { error: deleteError } = await supabaseAdmin
      .from("games")
      .delete()
      .eq("id", game.id);
    if (deleteError) {
      console.error("Failed to clean up orphaned game", deleteError);
    }
    return NextResponse.json(
      { error: "Failed to initialize game round" },
      { status: 500 },
    );
  }

  const response: CreateGameResponse = { gameId: game.id };
  return NextResponse.json(response, { status: 201 });
}
