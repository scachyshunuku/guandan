// Small read helpers shared by the game/[id] API routes (join, start,
// play-cards, pass) to avoid duplicating the same lookups. Only covers what
// those routes actually need — full row<->type mapping for the GET state
// endpoint belongs to whichever task builds it (IMPLEMENTATION.md Task 3.4).
import { supabaseAdmin } from "./supabaseAdmin";
import { STANDARD_RANK_ORDER } from "./cardUtils";
import { isValidUuid } from "./http";
import type {
  CardWithWild,
  GameState,
  GameStatus,
  PlayerPosition,
  RoundStatus,
  StandardRank,
} from "./types";

export interface GameRow {
  id: string;
  status: GameStatus;
  team_a_level: number;
  team_b_level: number;
}

// A malformed `gameId` (not a syntactically valid UUID) can never match a
// row, so it's treated the same as "not found" — short-circuiting here
// avoids a Postgres 22P02 error that would otherwise surface as an unhandled
// 500 in every caller (join, start, resolveTurn) instead of their existing
// 404 handling. See isValidUuid's doc comment in lib/http.ts.
export async function getGame(gameId: string): Promise<GameRow | null> {
  if (!isValidUuid(gameId)) return null;

  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id, status, team_a_level, team_b_level")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The level rank in effect for wild-card/level-card purposes (RULES.md
// "Level Cards & Wild Cards"): the higher of the two teams' levels, since
// there's no separate "declaring team" column — the team further ahead is
// the one whose level the hand is played at.
export function levelRankForGame(game: Pick<GameRow, "team_a_level" | "team_b_level">): StandardRank {
  const level = Math.max(game.team_a_level, game.team_b_level);
  return STANDARD_RANK_ORDER[level - 2];
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
  game_state: GameState;
  current_player_turn: PlayerPosition | null;
  leader_position: PlayerPosition | null;
  status: RoundStatus;
}

// The round currently in play, i.e. the highest round_number for this game.
export async function getLatestRound(
  gameId: string,
): Promise<GameRoundRow | null> {
  const { data, error } = await supabaseAdmin
    .from("game_rounds")
    .select("id, round_number, game_state, current_player_turn, leader_position, status")
    .eq("game_id", gameId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const ALL_POSITIONS = [0, 1, 2, 3] as const;

// `position` comes from an untrusted request body typed only as
// `PlayerPosition | undefined` by the caller's `Partial<...Request>` cast —
// that cast is compile-time only, so a malicious/malformed body (e.g.
// `position: null`) still reaches here at runtime as whatever JSON.parse
// produced. Without this check, `null` in particular would slip past a naive
// `caller.position !== position` comparison by matching a spectator's
// `position: null` row.
export function isPlayerPosition(value: unknown): value is PlayerPosition {
  return (ALL_POSITIONS as readonly unknown[]).includes(value);
}

// GameRoundRow with leader_position/current_player_turn narrowed to non-null
// — both are checked before resolveTurn ever returns `ok: true`, so callers
// don't need their own `!`/null-guards on fields that are already known-good.
export interface ActiveRoundRow
  extends Omit<GameRoundRow, "leader_position" | "current_player_turn"> {
  leader_position: PlayerPosition;
  current_player_turn: PlayerPosition;
}

export type TurnContext =
  | { ok: true; game: GameRow; round: ActiveRoundRow; caller: ParticipantRow }
  | { ok: false; status: number; error: string };

// Shared preamble for the play-cards and pass routes (IMPLEMENTATION.md
// Task 3.2): resolves the game, its current round, and the calling
// participant, and checks that it's actually their turn to act. Returns a
// plain result rather than a NextResponse so each route can shape its own
// JSON error body (their declared response types differ).
export async function resolveTurn(
  gameId: string,
  playerId: string,
  position: PlayerPosition,
): Promise<TurnContext> {
  const game = await getGame(gameId);
  if (!game) return { ok: false, status: 404, error: "Game not found" };
  if (game.status !== "in_progress") {
    return { ok: false, status: 400, error: "Game is not in progress" };
  }

  const round = await getLatestRound(gameId);
  if (!round || round.status !== "in_progress") {
    return { ok: false, status: 400, error: "Round is not accepting plays" };
  }
  if (round.leader_position === null) {
    return { ok: false, status: 400, error: "Round has not been dealt yet" };
  }

  const participants = await getParticipants(gameId);
  const caller = participants.find((p) => p.player_id === playerId);
  // A spectator (position === null) can never equal a concrete position, but
  // spelled out explicitly rather than relying on that coincidence — see
  // isPlayerPosition's comment above.
  if (!caller || caller.position === null || caller.position !== position) {
    return { ok: false, status: 403, error: "playerId does not match position" };
  }
  if (round.current_player_turn !== position) {
    return { ok: false, status: 400, error: "not your turn" };
  }

  return { ok: true, game, round: { ...round, leader_position: round.leader_position, current_player_turn: position }, caller };
}
