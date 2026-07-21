// Shared lookup for the current-state API: resolves the game's UUID from the
// URL (ARCHITECTURE.md section 2 "Game Code" — the `id` doubles as the
// shareable code, there's no separate code column) to its `games` row, or
// null if no such game exists.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidUuid } from "@/lib/http";
import type { GameRow } from "@/lib/db/mappers";

// A malformed `id` (not a syntactically valid UUID) can never match a row,
// so it's treated the same as "not found" — short-circuiting here avoids a
// Postgres 22P02 error that would otherwise surface as an unhandled
// exception instead of the caller's existing 404 handling. See
// isValidUuid's doc comment in lib/http.ts.
export async function fetchGameRowById(id: string) {
  if (!isValidUuid(id)) {
    return { data: null, error: null };
  }
  return supabaseAdmin.from("games").select("*").eq("id", id).maybeSingle<GameRow>();
}
