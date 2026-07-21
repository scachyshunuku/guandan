/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameState } from "@/lib/types";
import { PASS } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

async function seedGame(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data: game } = await fake
    .from("games")
    .insert({ status: "in_progress", ...overrides })
    .select("id")
    .single();
  return (game as { id: string }).id;
}

async function seedRound(
  gameId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = {
    currentTrick: [[{ rank: "7", suit: "CLUBS" }]],
    trickCount: 0,
  };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 1,
      game_state: gameState,
      leader_position: 0,
      current_player_turn: 1,
      ...overrides,
    })
    .select("id")
    .single();
  return (round as { id: string }).id;
}

async function seedParticipant(gameId: string, position: number, playerId: string) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
  });
}

function callPass(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/pass`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/pass", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callPass("does-not-exist", { playerId: "p1", position: 1 });
    expect(response.status).toBe(404);
  });

  it("rejects a playerId that doesn't match the claimed position", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 1, "p1");

    const response = await callPass(gameId, { playerId: "p1", position: 2 });
    expect(response.status).toBe(403);
  });

  it("rejects an out-of-range or malformed position", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 1, "p1");

    for (const position of [4, -1, "1", null, undefined]) {
      const response = await callPass(gameId, { playerId: "p1", position });
      expect(response.status).toBe(400);
    }
  });

  it("rejects a spectator (position: null) even when the round is frozen with current_player_turn: null", async () => {
    // Regression: see the matching test in play-cards/route.test.ts — a
    // naive `caller.position !== position` check would let a spectator's
    // `position: null` match a submitted `position: null`.
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: null });
    await seedParticipant(gameId, null as unknown as number, "spectator");

    const response = await callPass(gameId, { playerId: "spectator", position: null });
    expect(response.status).toBe(400);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
  });

  it("rejects a pass when it isn't the caller's turn", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 2 });
    await seedParticipant(gameId, 1, "p1");

    const response = await callPass(gameId, { playerId: "p1", position: 1 });
    expect(response.status).toBe(400);
  });

  it("rejects passing while leading an empty trick", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, {
      game_state: { currentTrick: [], trickCount: 0 },
      current_player_turn: 0,
    });
    await seedParticipant(gameId, 0, "p0");

    const response = await callPass(gameId, { playerId: "p0", position: 0 });
    expect(response.status).toBe(400);
  });

  it("records the pass and advances turn to the next position", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 1, "p1");

    const response = await callPass(gameId, { playerId: "p1", position: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBe(2);
    expect(round?.leader_position).toBe(0);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      [{ rank: "7", suit: "CLUBS" }],
      PASS,
    ]);

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      game_id: gameId,
      round_id: roundId,
      player_id: "p1",
      action_type: "pass",
    });
  });

  it("resolves the trick to its leader when the 3rd consecutive pass completes the rotation", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 3,
      game_state: { currentTrick: [[{ rank: "7", suit: "CLUBS" }], PASS, PASS], trickCount: 4 },
    });
    await seedParticipant(gameId, 3, "p3");

    const response = await callPass(gameId, { playerId: "p3", position: 3 });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.leader_position).toBe(0);
    expect(round?.current_player_turn).toBe(0);
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 5 });
  });

  it("lets only one of two concurrent double-submitted passes for the same turn succeed", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 1, "p1");

    const [r1, r2] = await Promise.all([
      callPass(gameId, { playerId: "p1", position: 1 }),
      callPass(gameId, { playerId: "p1", position: 1 }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      [{ rank: "7", suit: "CLUBS" }],
      PASS,
    ]);
    expect(fake._tables.game_actions).toHaveLength(1);
  });

  it("rolls back the round if the action log write fails after claiming the turn", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 1, "p1");
    fake._failNext("game_actions", "insert");

    const response = await callPass(gameId, { playerId: "p1", position: 1 });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBe(1);
    expect(round?.leader_position).toBe(0);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      [{ rank: "7", suit: "CLUBS" }],
    ]);

    // A retry after the rollback passes cleanly.
    const retry = await callPass(gameId, { playerId: "p1", position: 1 });
    expect(retry.status).toBe(200);
  });
});
