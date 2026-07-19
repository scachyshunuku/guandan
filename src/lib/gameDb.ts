// Small read helpers shared by the game/[id] API routes (join, start, and
// later play-cards/pass) to avoid duplicating the same lookups. Only covers
// what those routes actually need — full row<->type mapping for the GET
// state endpoint belongs to whichever task builds it (IMPLEMENTATION.md
// Task 3.4).
import { supabaseAdmin } from "./supabaseAdmin";
import type { CardWithWild, GameStatus, PlayerPosition } from "./types";

export interface GameRow {
  id: string;
  status: GameStatus;
}

export async function getGame(gameId: string): Promise<GameRow | null> {
  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id, status")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ParticipantRow {
  id: string;
  player_id: string;
  player_name: string;
  position: PlayerPosition | null;
  hand: CardWithWild[];
}

export async function getParticipants(
  gameId: string,
): Promise<ParticipantRow[]> {
  const { data, error } = await supabaseAdmin
    .from("game_participants")
    .select("id, player_id, player_name, position, hand")
    .eq("game_id", gameId);
  if (error) throw error;
  return data ?? [];
}

export interface GameRoundRow {
  id: string;
  round_number: number;
}

// The round currently in play, i.e. the highest round_number for this game.
export async function getLatestRound(
  gameId: string,
): Promise<GameRoundRow | null> {
  const { data, error } = await supabaseAdmin
    .from("game_rounds")
    .select("id, round_number")
    .eq("game_id", gameId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
