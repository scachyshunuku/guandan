// POST /api/game/[id]/join — see ARCHITECTURE.md sections 5 & 8 and
// IMPLEMENTATION.md Task 3.1. Assigns the first open seat (0-3), or marks
// the joiner a spectator if all seats are taken (or the game already
// started).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGame, getLatestRound, getParticipants } from "@/lib/gameDb";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type {
  JoinActionData,
  JoinGameRequest,
  JoinGameResponse,
  PlayerPosition,
} from "@/lib/types";

const ALL_POSITIONS = [0, 1, 2, 3] as const;

function firstOpenPosition(
  occupied: ReadonlySet<number>,
): PlayerPosition | null {
  for (const position of ALL_POSITIONS) {
    if (!occupied.has(position)) return position;
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<JoinGameRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerName, playerId } = parsed.body;
  if (!playerName || !playerId) {
    return NextResponse.json(
      { error: "playerName and playerId are required" },
      { status: 400 },
    );
  }

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const participants = await getParticipants(gameId);

  // Idempotent rejoin: if this session already has a seat/spot in this
  // game (e.g. a page refresh), return their existing state rather than
  // erroring on the game_id+player_id unique constraint.
  const existing = participants.find((p) => p.player_id === playerId);
  if (existing) {
    const response: JoinGameResponse =
      existing.position === null
        ? { spectator: true }
        : { spectator: false, position: existing.position, hand: existing.hand };
    return NextResponse.json(response);
  }

  const occupied = new Set(
    participants.flatMap((p) => (p.position === null ? [] : [p.position])),
  );
  const position =
    game.status === "waiting" ? firstOpenPosition(occupied) : null;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("game_participants")
    .insert({
      game_id: gameId,
      player_name: playerName,
      player_id: playerId,
      position,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    // A unique-constraint violation (Postgres code 23505) means another
    // join raced us for this seat, or for the game_id+player_id pair —
    // retrying will pick the next open seat. Anything else is a genuine
    // failure, not a race, so surface it as one.
    if (insertError?.code === "23505") {
      return NextResponse.json(
        { error: "Failed to join game, please retry" },
        { status: 409 },
      );
    }
    console.error("Failed to insert game_participants row", insertError);
    return NextResponse.json({ error: "Failed to join game" }, { status: 500 });
  }

  const round = await getLatestRound(gameId);
  if (round) {
    const actionData: JoinActionData = { playerName, position };
    const { error: actionError } = await supabaseAdmin
      .from("game_actions")
      .insert({
        game_id: gameId,
        round_id: round.id,
        player_id: playerId,
        action_type: "join",
        action_data: actionData,
      });
    if (actionError) {
      console.error("Failed to log join game_action", actionError);
    }
  }

  // Broadcast so other connected clients' useGameRealtimeSync picks up the
  // new participant (see ARCHITECTURE.md section 10). hand is explicitly
  // zeroed rather than trusting the inserted row's value, since a hand must
  // never leave the server on this channel — even though a freshly inserted
  // participant always has an empty one today.
  await broadcastToGame(gameId, "participant_joined", { ...inserted, hand: [] });

  const response: JoinGameResponse =
    inserted.position === null
      ? { spectator: true }
      : { spectator: false, position: inserted.position, hand: inserted.hand };
  return NextResponse.json(response, { status: 201 });
}
