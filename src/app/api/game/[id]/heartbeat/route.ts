// POST /api/game/[id]/heartbeat — ARCHITECTURE.md "Disconnect & Reconnect".
// Any connected client (seated or spectating) pings this periodically
// (useHeartbeat, wired into useGame) to keep its own participant row's
// `last_heartbeat` fresh. `isConnected` itself isn't trusted from this
// route's own write alone: gameStateResponse.ts re-derives it from
// `lastHeartbeat` freshness on every GET/refetch, so a client that goes
// quiet is correctly shown as disconnected even if nothing ever "sweeps" it.
// This route's sweep (marking every *other* stale participant's stored
// `is_connected` false) exists only so already-open clients see that
// transition live via a `participant_updated` broadcast, without waiting on
// their own next refetch.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGame } from "@/lib/gameDb";
import type { GameParticipantRow } from "@/lib/db/mappers";
import { isHeartbeatRecent } from "@/lib/presence";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { HeartbeatRequest, HeartbeatResponse } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<HeartbeatRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  const game = await getGame(gameId);
  if (!game) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("game_participants")
    .select("*")
    .eq("game_id", gameId);
  if (error) {
    console.error("Failed to load participants for heartbeat", error);
    return NextResponse.json({ error: "Failed to record heartbeat" }, { status: 500 });
  }
  const participants = (data ?? []) as GameParticipantRow[];
  const caller = participants.find((p) => p.player_id === playerId);
  if (!caller) {
    return NextResponse.json({ error: "playerId is not a participant in this game" }, { status: 403 });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Every *other* participant whose last-known heartbeat has gone stale but
  // is still marked connected in the DB - flipped here so a still-open
  // client's next broadcast reflects it live, matching what
  // gameStateResponse.ts already derives fresh on every GET.
  const staleParticipants = participants.filter(
    (p) => p.player_id !== playerId && p.is_connected && !isHeartbeatRecent(p.last_heartbeat, now.getTime()),
  );

  const [callerUpdate, ...staleUpdates] = await Promise.all([
    supabaseAdmin
      .from("game_participants")
      .update({ is_connected: true, last_heartbeat: nowIso })
      .eq("id", caller.id)
      .select("*")
      .single(),
    ...staleParticipants.map((p) =>
      supabaseAdmin
        .from("game_participants")
        .update({ is_connected: false })
        .eq("id", p.id)
        .select("*")
        .single(),
    ),
  ]);

  const failures = [callerUpdate, ...staleUpdates].filter((r) => r.error);
  if (failures.length > 0) {
    console.error("Failed to persist heartbeat/staleness updates", failures.map((f) => f.error));
    // Best-effort, same as broadcastToGame below: the next heartbeat (this
    // client's or another's) naturally retries the same writes, and
    // gameStateResponse.ts's own derivation means no client is ever showing
    // stale-but-wrong data from this failing - just returning early instead
    // of a 500, since the caller's own liveness isn't actually in question.
  }

  // Raw (snake_case) rows, matching join/route.ts's participant_joined
  // broadcast convention - useGameRealtimeSync.ts's handler maps it on
  // arrival, the same as every other participant broadcast. `hand` is
  // explicitly zeroed rather than trusting the row's actual value, same
  // reasoning as participant_joined: this is player-identifying data going
  // out unscoped to everyone in the game. hand_count is carried separately
  // (from this same row, before zeroing) so the recipient's card-count
  // display doesn't get stomped back to 0 by this connectivity-only update.
  await Promise.all(
    [callerUpdate, ...staleUpdates]
      .filter((r) => !r.error && r.data != null)
      .map((r) => {
        const row = r.data as GameParticipantRow;
        return broadcastToGame(gameId, "participant_updated", {
          ...row,
          hand: [],
          hand_count: row.hand.length,
        });
      }),
  );

  const response: HeartbeatResponse = { success: true };
  return NextResponse.json(response);
}
