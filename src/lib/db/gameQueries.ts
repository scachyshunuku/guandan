// Shared lookup used by every /api/game/[code]/** route: resolves the
// shareable game code from the URL (ARCHITECTURE.md section 2 "Game Code")
// to its `games` row, or null if no such game exists.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameRow } from "@/lib/db/mappers";

export function fetchGameRowByCode(code: string) {
  return supabaseAdmin.from("games").select("*").eq("code", code).maybeSingle<GameRow>();
}
