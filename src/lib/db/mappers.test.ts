import { describe, expect, it } from "vitest";
import {
  mapGameActionRow,
  mapGameParticipantRow,
  mapGameRoundRow,
  mapGameRow,
  type GameActionRow,
  type GameParticipantRow,
  type GameRoundRow,
  type GameRow,
} from "./mappers";

describe("mapGameRow", () => {
  it("maps snake_case columns to the camelCase Game shape", () => {
    const row: GameRow = {
      id: "game-1",
      code: "ABC123",
      status: "in_progress",
      team_a_level: 5,
      team_b_level: 2,
      winning_team: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    expect(mapGameRow(row)).toEqual({
      id: "game-1",
      code: "ABC123",
      status: "in_progress",
      teamALevel: 5,
      teamBLevel: 2,
      winningTeam: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("preserves a winning team of 0 rather than treating it as falsy", () => {
    const row: GameRow = {
      id: "game-1",
      code: "ABC123",
      status: "completed",
      team_a_level: 14,
      team_b_level: 9,
      winning_team: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    expect(mapGameRow(row).winningTeam).toBe(0);
  });
});

describe("mapGameRoundRow", () => {
  it("maps snake_case columns to the camelCase GameRound shape", () => {
    const row: GameRoundRow = {
      id: "round-1",
      game_id: "game-1",
      round_number: 3,
      game_state: { currentTrick: [], trickCount: 2 },
      current_player_turn: 1,
      leader_position: 0,
      status: "in_progress",
      finishing_positions: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    expect(mapGameRoundRow(row)).toEqual({
      id: "round-1",
      gameId: "game-1",
      roundNumber: 3,
      gameState: { currentTrick: [], trickCount: 2 },
      currentPlayerTurn: 1,
      leaderPosition: 0,
      status: "in_progress",
      finishingPositions: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("passes through finishing positions once a hand has ended", () => {
    const row: GameRoundRow = {
      id: "round-1",
      game_id: "game-1",
      round_number: 1,
      game_state: { currentTrick: [], trickCount: 12 },
      current_player_turn: null,
      leader_position: 2,
      status: "card_exchange",
      finishing_positions: [1, 4, 2, 3],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    expect(mapGameRoundRow(row).finishingPositions).toEqual([1, 4, 2, 3]);
  });
});

describe("mapGameParticipantRow", () => {
  it("maps snake_case columns to the camelCase GameParticipant shape", () => {
    const row: GameParticipantRow = {
      id: "participant-1",
      game_id: "game-1",
      player_name: "Alice",
      player_id: "session-abc",
      position: 0,
      hand: [{ rank: "ACE", suit: "SPADES" }],
      is_connected: true,
      connected_at: "2026-01-01T00:00:00Z",
      last_heartbeat: "2026-01-01T00:05:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(mapGameParticipantRow(row)).toEqual({
      id: "participant-1",
      gameId: "game-1",
      playerName: "Alice",
      playerId: "session-abc",
      position: 0,
      hand: [{ rank: "ACE", suit: "SPADES" }],
      isConnected: true,
      connectedAt: "2026-01-01T00:00:00Z",
      lastHeartbeat: "2026-01-01T00:05:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("maps a null position for spectators", () => {
    const row: GameParticipantRow = {
      id: "participant-2",
      game_id: "game-1",
      player_name: "Spectator Sam",
      player_id: "session-def",
      position: null,
      hand: [],
      is_connected: true,
      connected_at: "2026-01-01T00:00:00Z",
      last_heartbeat: "2026-01-01T00:05:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(mapGameParticipantRow(row).position).toBeNull();
  });
});

describe("mapGameActionRow", () => {
  it("maps snake_case columns to the camelCase GameAction shape", () => {
    const row: GameActionRow = {
      id: "action-1",
      game_id: "game-1",
      round_id: "round-1",
      player_id: "session-abc",
      action_type: "card_played",
      action_data: { cards: [{ rank: "ACE", suit: "SPADES" }], position: 0 },
      created_at: "2026-01-01T00:00:00.123456Z",
    };

    expect(mapGameActionRow(row)).toEqual({
      id: "action-1",
      gameId: "game-1",
      roundId: "round-1",
      playerId: "session-abc",
      actionType: "card_played",
      actionData: { cards: [{ rank: "ACE", suit: "SPADES" }], position: 0 },
      createdAt: "2026-01-01T00:00:00.123456Z",
    });
  });
});
