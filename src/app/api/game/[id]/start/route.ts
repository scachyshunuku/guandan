// POST /api/game/[id]/start — see ARCHITECTURE.md section 7 ("Start Game")
// and IMPLEMENTATION.md Task 3.1. Any seated player can trigger it once all
// 4 seats are filled; shuffles & deals, picks a random first leader, and
// flips the game to 'in_progress'.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dealHands } from "@/lib/deck";
import { getGame, getLatestRound, getParticipants, levelRankForGame } from "@/lib/gameDb";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type {
  PlayerPosition,
  StartGameRequest,
  StartGameResponse,
} from "@/lib/types";

const ALL_POSITIONS = [0, 1, 2, 3] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<StartGameRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json(
      { error: "playerId is required" },
      { status: 400 },
    );
  }

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (game.status !== "waiting") {
    return NextResponse.json(
      { error: "Game has already started" },
      { status: 400 },
    );
  }

  const participants = await getParticipants(gameId);
  const caller = participants.find((p) => p.player_id === playerId);
  if (!caller || caller.position === null) {
    return NextResponse.json(
      { error: "Only a seated player can start the game" },
      { status: 403 },
    );
  }

  const seated = new Map<PlayerPosition, (typeof participants)[number]>();
  for (const p of participants) {
    if (p.position !== null) seated.set(p.position, p);
  }
  if (!ALL_POSITIONS.every((position) => seated.has(position))) {
    return NextResponse.json(
      { error: "Need 4 players to start" },
      { status: 400 },
    );
  }

  const round = await getLatestRound(gameId);
  if (!round) {
    return NextResponse.json(
      { error: "Game round not initialized" },
      { status: 500 },
    );
  }

  // Claim the right to deal by atomically flipping status only if it's
  // still 'waiting'. This is the concurrency guard: if two seated players
  // click "Start" at nearly the same time, only one of these conditional
  // updates can match a row, so only one caller proceeds to deal — without
  // it, both would shuffle independently and race 4 separate per-seat
  // writes, potentially mixing cards from two different deals into one
  // "hand" (duplicated/missing cards across the table).
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("games")
    .update({ status: "in_progress" })
    .eq("id", gameId)
    .eq("status", "waiting")
    .select("*");
  if (claimError) {
    console.error("Failed to claim game start", claimError);
    return NextResponse.json(
      { error: "Failed to start game" },
      { status: 500 },
    );
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "Game was already started by another player" },
      { status: 409 },
    );
  }

  const hands = dealHands(levelRankForGame(game));
  const leader = Math.floor(Math.random() * 4) as PlayerPosition;

  const roundUpdate = supabaseAdmin
    .from("game_rounds")
    .update({ leader_position: leader, current_player_turn: leader })
    .eq("id", round.id)
    .select("*")
    .single();

  const [...results] = await Promise.all([
    ...ALL_POSITIONS.map((position) =>
      supabaseAdmin
        .from("game_participants")
        .update({ hand: hands[position] })
        .eq("id", seated.get(position)!.id),
    ),
    roundUpdate,
  ]);
  const roundUpdateResult = results[results.length - 1];
  const failure = results.find((r) => r.error);
  if (failure) {
    console.error("Failed to persist deal after claiming start", failure.error);
    // Revert the claim (and any hands this batch did manage to write) so a
    // retry by any seated player deals cleanly instead of being stuck
    // behind a half-dealt 'in_progress' game, and so a rejoin in the
    // meantime doesn't see a stale dealt hand on a 'waiting' game. Scoped
    // to status='in_progress' so this can't clobber a state change that
    // happened for an unrelated reason.
    const emptyHand: typeof hands[number] = [];
    const [rollback] = await Promise.all([
      supabaseAdmin
        .from("games")
        .update({ status: "waiting" })
        .eq("id", gameId)
        .eq("status", "in_progress"),
      supabaseAdmin
        .from("game_rounds")
        .update({ leader_position: null, current_player_turn: null })
        .eq("id", round.id),
      ...ALL_POSITIONS.map((position) =>
        supabaseAdmin
          .from("game_participants")
          .update({ hand: emptyHand })
          .eq("id", seated.get(position)!.id),
      ),
    ]);
    if (rollback.error) {
      console.error("Failed to roll back game status after failed deal", rollback.error);
    }
    return NextResponse.json(
      { error: "Failed to start game, please retry" },
      { status: 500 },
    );
  }

  // Broadcast the new game/round state so other players' and spectators'
  // useGameRealtimeSync picks up the deal (see ARCHITECTURE.md section 10 —
  // hands are never included, only the public games/game_rounds fields).
  // Best-effort: broadcastToGame logs and swallows send failures rather than
  // throwing, so a dropped broadcast doesn't fail a start that already
  // succeeded — a client that misses it still catches up on refresh/rejoin.
  await Promise.all([
    broadcastToGame(gameId, "game_updated", claimed[0]),
    broadcastToGame(gameId, "round_updated", roundUpdateResult.data),
  ]);

  const response: StartGameResponse = {
    success: true,
    hand: hands[caller.position],
  };
  return NextResponse.json(response);
}
