// Sends a Realtime `broadcast` message on the `games:[gameId]` channel that
// hooks/useGameRealtimeSync.ts listens on. This project doesn't rely on
// Supabase's `postgres_changes` (it needs each table added to the
// `supabase_realtime` publication, extra per-project setup this app doesn't
// assume is done) — every state change reaches clients via an explicit
// `broadcast` call instead. See ARCHITECTURE.md section 10.
//
// Uses `httpSend`, which always goes over REST rather than opening a
// WebSocket connection, so a one-off server-side send doesn't need to wait
// on a `subscribe()` handshake first.
import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function broadcastToGame(
  gameId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const channel = supabaseAdmin.channel(`games:${gameId}`);
  try {
    const result = await channel.httpSend(event, payload);
    if (!result.success) {
      console.error(`Failed to broadcast "${event}" for game ${gameId}`, result.error);
    }
  } finally {
    await supabaseAdmin.removeChannel(channel);
  }
}
