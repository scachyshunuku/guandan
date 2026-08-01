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
import type { DriveBotsResponse, GameState } from "@/lib/types";
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

async function seedRound(gameId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  await fake.from("game_rounds").insert({
    game_id: gameId,
    round_number: 1,
    game_state: gameState,
    leader_position: 0,
    current_player_turn: 0,
    ...overrides,
  });
}

async function seedParticipant(
  gameId: string,
  position: number,
  playerId: string,
  isBot: boolean,
) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
    hand: [{ rank: "7", suit: "CLUBS" }],
    is_bot: isBot,
  });
}

function callDriveBots(gameId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/drive-bots`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/drive-bots", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callDriveBots("does-not-exist");
    expect(response.status).toBe(404);
  });

  it("no-ops when it's a human's turn", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 0 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);

    const response = await callDriveBots(gameId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DriveBotsResponse;
    expect(body).toEqual({ acted: false });

    // Nothing was played on the human's behalf.
    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect((round?.game_state as GameState).currentTrick).toEqual([]);
  });

  it("acts once when it's a bot's turn", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 1 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);

    const response = await callDriveBots(gameId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DriveBotsResponse;
    expect(body).toEqual({ acted: true });

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      { position: 1, play: [{ rank: "7", suit: "CLUBS" }] },
    ]);
  });

  it("returns a 500 with a diagnostic reason when a dispatched action fails", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 1 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);
    fake._failNext("game_rounds", "update");

    const response = await callDriveBots(gameId);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("bot action failed with status 500");
  });
});
