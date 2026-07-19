import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as gameDb from "@/lib/gameDb";
import type { JoinGameResponse } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
  jest.restoreAllMocks();
});

async function seedGame(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data: game } = await fake.from("games").insert(overrides).select("id").single();
  const gameId = (game as { id: string }).id;
  await fake.from("game_rounds").insert({
    game_id: gameId,
    round_number: 1,
    game_state: { currentTrick: [], trickCount: 0 },
  });
  return gameId;
}

function callJoin(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/join", () => {
  it("assigns positions 0-3 to the first four joiners", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) {
      const response = await callJoin(gameId, {
        playerName: `Player ${i}`,
        playerId: `p${i}`,
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as JoinGameResponse;
      expect(body).toEqual({ spectator: false, position: i, hand: [] });
    }
  });

  it("marks the 5th joiner as a spectator", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) {
      await callJoin(gameId, { playerName: `Player ${i}`, playerId: `p${i}` });
    }
    const response = await callJoin(gameId, {
      playerName: "Latecomer",
      playerId: "p4",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ spectator: true });
  });

  it("logs a join game_action with the assigned position", async () => {
    const gameId = await seedGame();
    await callJoin(gameId, { playerName: "Alice", playerId: "alice" });

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      game_id: gameId,
      player_id: "alice",
      action_type: "join",
      action_data: { playerName: "Alice", position: 0 },
    });
  });

  it("is idempotent for a rejoin with the same playerId", async () => {
    const gameId = await seedGame();
    await callJoin(gameId, { playerName: "Alice", playerId: "alice" });

    const response = await callJoin(gameId, {
      playerName: "Alice",
      playerId: "alice",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      spectator: false,
      position: 0,
      hand: [],
    });
    expect(fake._tables.game_participants).toHaveLength(1);
  });

  it("assigns everyone as a spectator once the game has started", async () => {
    const gameId = await seedGame({ status: "in_progress" });
    const response = await callJoin(gameId, {
      playerName: "Late",
      playerId: "late",
    });
    expect(await response.json()).toEqual({ spectator: true });
  });

  it("rejects a request missing playerName or playerId", async () => {
    const gameId = await seedGame();
    const response = await callJoin(gameId, { playerName: "Alice" });
    expect(response.status).toBe(400);
  });

  it("404s for a nonexistent game", async () => {
    const response = await callJoin("does-not-exist", {
      playerName: "Alice",
      playerId: "alice",
    });
    expect(response.status).toBe(404);
  });

  it("409s when two joins race for the same open seat", async () => {
    const gameId = await seedGame();
    // Force both concurrent calls to see the same (empty) participant list,
    // so both independently decide position 0 is open — reproducing the
    // race a real DB would resolve via the (game_id, position) unique
    // constraint, which the fake now enforces (see findUniqueViolation in
    // testUtils/fakeSupabase.ts).
    jest.spyOn(gameDb, "getParticipants").mockResolvedValue([]);

    const [r1, r2] = await Promise.all([
      callJoin(gameId, { playerName: "Alice", playerId: "alice" }),
      callJoin(gameId, { playerName: "Bob", playerId: "bob" }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(fake._tables.game_participants).toHaveLength(1);
  });
});
