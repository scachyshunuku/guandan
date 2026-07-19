// Shared lookup used by every /api/game/[id]/** route: resolves the game's
// UUID from the URL (ARCHITECTURE.md section 2 "Game Code" — the `id`
// doubles as the shareable code, there's no separate code column) to its
// `games` row, or null if no such game exists.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameRow } from "@/lib/db/mappers";

export function fetchGameRowById(id: string) {
  return supabaseAdmin.from("games").select("*").eq("id", id).maybeSingle<GameRow>();
}
