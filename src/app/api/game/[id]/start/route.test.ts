/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { StartGameResponse } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<
  typeof broadcastToGame
>;

beforeEach(() => {
  fake._reset();
  mockBroadcastToGame.mockClear();
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

async function seedParticipant(
  gameId: string,
  position: number | null,
  playerId: string,
) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
  });
}

function callStart(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/start`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/start", () => {
  it("requires 4 seated players", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, 0, "p0");
    await seedParticipant(gameId, 1, "p1");

    const response = await callStart(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);

    const gameRow = fake._tables.games.find((g) => g.id === gameId);
    expect(gameRow?.status).toBe("waiting");
  });

  it("rejects a caller who isn't a seated player", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);

    const response = await callStart(gameId, { playerId: "spectator" });
    expect(response.status).toBe(403);
  });

  it("deals 27 cards to each seat, picks a leader, and flips status", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);

    const response = await callStart(gameId, { playerId: "p2" });
    expect(response.status).toBe(200);

    const body = (await response.json()) as StartGameResponse;
    expect(body.success).toBe(true);
    expect(body.hand).toHaveLength(27);

    const gameRow = fake._tables.games.find((g) => g.id === gameId);
    expect(gameRow?.status).toBe("in_progress");

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect(round?.leader_position).toEqual(expect.any(Number));
    expect(round?.current_player_turn).toBe(round?.leader_position);

    const hands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((p) => p.hand as unknown[]);
    for (const hand of hands) expect(hand).toHaveLength(27);

    const allCards = hands.flat();
    expect(allCards).toHaveLength(108);
    const uniqueCardKeys = new Set(allCards.map((c) => JSON.stringify(c)));
    // 108 cards is 2 copies each of 54 distinct cards.
    expect(uniqueCardKeys.size).toBe(54);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_updated",
      expect.objectContaining({ id: gameId, status: "in_progress" }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({
        id: round?.id,
        leader_position: round?.leader_position,
        current_player_turn: round?.current_player_turn,
      }),
    );
  });

  it("rejects starting a game that already started", async () => {
    const gameId = await seedGame({ status: "in_progress" });
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);

    const response = await callStart(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
  });

  it("404s for a nonexistent game", async () => {
    const response = await callStart("does-not-exist", { playerId: "p0" });
    expect(response.status).toBe(404);
  });

  it("lets only one of two concurrent start calls deal, leaving one clean full deal", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);

    // The status flip in the route is a conditional update (`.eq("status",
    // "waiting")`), which acts as a compare-and-swap: whichever call's
    // update lands first claims the game, the other necessarily finds the
    // row already flipped. That's deterministic under Node's single-
    // threaded execution regardless of exact interleaving, so this isn't
    // flaky — it's exercising the actual concurrency guard, not luck.
    const [r1, r2] = await Promise.all([
      callStart(gameId, { playerId: "p0" }),
      callStart(gameId, { playerId: "p1" }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const hands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((p) => p.hand as unknown[]);
    for (const hand of hands) expect(hand).toHaveLength(27);
    expect(hands.flat()).toHaveLength(108);
  });

  it("rolls back status, hands, and leader/turn if a deal write fails partway", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);
    // Fail one of the per-seat hand writes inside the deal's Promise.all.
    fake._failNext("game_participants", "update");

    const response = await callStart(gameId, { playerId: "p0" });
    expect(response.status).toBe(500);
    expect(mockBroadcastToGame).not.toHaveBeenCalled();

    const gameRow = fake._tables.games.find((g) => g.id === gameId);
    expect(gameRow?.status).toBe("waiting");

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect(round?.leader_position).toBeNull();
    expect(round?.current_player_turn).toBeNull();

    const hands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .map((p) => p.hand);
    for (const hand of hands) expect(hand).toEqual([]);

    // A retry after the rollback deals a clean, complete hand.
    const retry = await callStart(gameId, { playerId: "p0" });
    expect(retry.status).toBe(200);
    const retryHands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .map((p) => p.hand as unknown[]);
    for (const hand of retryHands) expect(hand).toHaveLength(27);
  });
});
