// POST /api/game/[id]/add-bot — IMPLEMENTATION.md Phase 8 (mixed human+bot
// play). Seats a server-generated bot into the first open position, so a
// human can play alongside bot-filled seats instead of needing 3 other
// humans. Mirrors start/route.ts's gating (only a seated player may act,
// only while the game is still 'waiting'). Reuses join/route.ts's exported
// POST in-process rather than re-deriving seat assignment here.
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGame, getParticipants } from "@/lib/gameDb";
import { POST as joinGame } from "@/app/api/game/[id]/join/route";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { GameParticipantRow } from "@/lib/db/mappers";
import type { AddBotRequest, AddBotResponse, JoinGameResponse } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<AddBotRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  if (game.status !== "waiting") {
    return NextResponse.json(
      { error: "Bots can only be added before the game starts" },
      { status: 400 },
    );
  }

  const participants = await getParticipants(gameId);
  const caller = participants.find((p) => p.player_id === playerId);
  if (!caller || caller.position === null) {
    return NextResponse.json({ error: "Only a seated player can add a bot" }, { status: 403 });
  }

  const occupied = new Set(
    participants.flatMap((p) => (p.position === null ? [] : [p.position])),
  );
  if (occupied.size >= 4) {
    return NextResponse.json({ error: "No open seat for a bot" }, { status: 400 });
  }

  // Named by seat number for display (`Bot 1`, `Bot 2`, ...). Relies on
  // occupied seats always being the contiguous prefix {0, ..., occupied.size
  // - 1}: true today since
  // there's no `leave` route yet to open a gap behind an already-filled
  // seat (see join/route.ts's own firstOpenPosition) — if that ever
  // changes, this naming (cosmetic only, not used for seat assignment
  // itself) may need to read the assigned position back instead.
  const botPlayerId = randomUUID();
  const joinRequest = new Request(`http://localhost/api/game/${gameId}/join`, {
    method: "POST",
    body: JSON.stringify({ playerName: `Bot ${occupied.size + 1}`, playerId: botPlayerId }),
  });
  const joinResponse = await joinGame(joinRequest, { params: Promise.resolve({ id: gameId }) });
  if (!joinResponse.ok) {
    const body: unknown = await joinResponse.json();
    console.error("Failed to seat bot via join", body);
    return NextResponse.json({ error: "Failed to add bot" }, { status: 500 });
  }
  const joined = (await joinResponse.json()) as JoinGameResponse;
  if (joined.spectator) {
    // Shouldn't happen: this route already confirmed an open seat above,
    // and nothing else can seat a participant between that check and this
    // in-process call within a single request. Defensive, not expected.
    console.error("Bot was seated as a spectator unexpectedly", { gameId, botPlayerId });
    return NextResponse.json({ error: "Failed to add bot" }, { status: 500 });
  }

  const { data: updatedRow, error } = await supabaseAdmin
    .from("game_participants")
    .update({ is_bot: true })
    .eq("game_id", gameId)
    .eq("player_id", botPlayerId)
    .select("*")
    .single();
  if (error || !updatedRow) {
    console.error("Failed to mark newly-added participant as a bot", error);
    return NextResponse.json({ error: "Failed to add bot" }, { status: 500 });
  }

  // Broadcasts the is_bot flip (join's own call already broadcast
  // participant_joined for the seat itself) — same participant_updated
  // convention as heartbeat/route.ts, so connected clients show the "Bot"
  // label live without a refetch.
  const row = updatedRow as GameParticipantRow;
  await broadcastToGame(gameId, "participant_updated", {
    ...row,
    hand: [],
    hand_count: row.hand.length,
    hand_order: null,
  });

  const response: AddBotResponse = { success: true, position: joined.position };
  return NextResponse.json(response, { status: 201 });
}
