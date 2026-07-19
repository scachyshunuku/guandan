// Maps raw Supabase rows (snake_case columns, see
// supabase/migrations/001_initial_schema.sql) onto the camelCase types the
// app works with (src/lib/types.ts). JSONB payload fields (game_state,
// hand, action_data) are already written by the app in camelCase, so they
// pass through unchanged.

import type {
  CardWithWild,
  Game,
  GameAction,
  GameActionData,
  GameActionType,
  GameParticipant,
  GameRound,
  GameState,
  GameStatus,
  PlayerPosition,
  RoundStatus,
  Team,
} from "@/lib/types";

export interface GameRow {
  id: string;
  status: string;
  team_a_level: number;
  team_b_level: number;
  winning_team: number | null;
  created_at: string;
  updated_at: string;
}

export interface GameRoundRow {
  id: string;
  game_id: string;
  round_number: number;
  game_state: GameState;
  current_player_turn: number | null;
  leader_position: number | null;
  status: string;
  finishing_positions: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface GameParticipantRow {
  id: string;
  game_id: string;
  player_name: string;
  player_id: string;
  position: number | null;
  hand: CardWithWild[];
  is_connected: boolean;
  connected_at: string;
  last_heartbeat: string;
  created_at: string;
}

export interface GameActionRow {
  id: string;
  game_id: string;
  round_id: string;
  player_id: string;
  action_type: string;
  action_data: GameActionData;
  created_at: string;
}

export function mapGameRow(row: GameRow): Game {
  return {
    id: row.id,
    status: row.status as GameStatus,
    teamALevel: row.team_a_level,
    teamBLevel: row.team_b_level,
    winningTeam: row.winning_team === null ? null : (row.winning_team as Team),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapGameRoundRow(row: GameRoundRow): GameRound {
  return {
    id: row.id,
    gameId: row.game_id,
    roundNumber: row.round_number,
    gameState: row.game_state,
    currentPlayerTurn: row.current_player_turn as PlayerPosition | null,
    leaderPosition: row.leader_position as PlayerPosition | null,
    status: row.status as RoundStatus,
    finishingPositions: row.finishing_positions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapGameParticipantRow(row: GameParticipantRow): GameParticipant {
  return {
    id: row.id,
    gameId: row.game_id,
    playerName: row.player_name,
    playerId: row.player_id,
    position: row.position as PlayerPosition | null,
    hand: row.hand,
    isConnected: row.is_connected,
    connectedAt: row.connected_at,
    lastHeartbeat: row.last_heartbeat,
    createdAt: row.created_at,
  };
}

export function mapGameActionRow(row: GameActionRow): GameAction {
  return {
    id: row.id,
    gameId: row.game_id,
    roundId: row.round_id,
    playerId: row.player_id,
    actionType: row.action_type as GameActionType,
    actionData: row.action_data,
    createdAt: row.created_at,
  };
}
