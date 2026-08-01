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
import type { AddBotResponse } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<typeof broadcastToGame>;

beforeEach(() => {
  fake._reset();
  mockBroadcastToGame.mockClear();
});

async function seedGame(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data: game } = await fake.from("games").insert(overrides).select("id").single();
  return (game as { id: string }).id;
}

async function seedParticipant(gameId: string, position: number | null, playerId: string) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
  });
}

function callAddBot(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/add-bot`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/add-bot", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callAddBot("does-not-exist", { playerId: "p0" });
    expect(response.status).toBe(404);
  });

  it("rejects a request missing playerId", async () => {
    const gameId = await seedGame();
    const response = await callAddBot(gameId, {});
    expect(response.status).toBe(400);
  });

  it("rejects a caller who isn't seated", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, 0, "p0");

    const response = await callAddBot(gameId, { playerId: "spectator" });
    expect(response.status).toBe(403);
  });

  it("rejects once the game has already started", async () => {
    const gameId = await seedGame({ status: "in_progress" });
    await seedParticipant(gameId, 0, "p0");

    const response = await callAddBot(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
  });

  it("seats a bot into the first open position and marks it is_bot", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, 0, "p0");
    await seedParticipant(gameId, 1, "p1");

    const response = await callAddBot(gameId, { playerId: "p0" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as AddBotResponse;
    expect(body).toEqual({ success: true, position: 2 });

    const participants = fake._tables.game_participants.filter((p) => p.game_id === gameId);
    expect(participants).toHaveLength(3);
    const bot = participants.find((p) => p.position === 2)!;
    expect(bot.is_bot).toBe(true);
    expect(bot.player_name).toBe("Bot 3");

    // The human participants are untouched.
    expect(participants.find((p) => p.player_id === "p0")?.is_bot).toBe(false);
    expect(participants.find((p) => p.player_id === "p1")?.is_bot).toBe(false);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "participant_updated",
      expect.objectContaining({ position: 2, is_bot: true }),
    );
  });

  it("rejects once all 4 seats are full", async () => {
    const gameId = await seedGame();
    for (let i = 0; i < 4; i++) await seedParticipant(gameId, i, `p${i}`);

    const response = await callAddBot(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
    const participants = fake._tables.game_participants.filter((p) => p.game_id === gameId);
    expect(participants).toHaveLength(4);
  });

  it("filling every remaining seat with bots lets the game start", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, 0, "human");

    for (let i = 0; i < 3; i++) {
      const response = await callAddBot(gameId, { playerId: "human" });
      expect(response.status).toBe(201);
    }

    const participants = fake._tables.game_participants.filter((p) => p.game_id === gameId);
    expect(participants).toHaveLength(4);
    expect(participants.filter((p) => p.is_bot).map((p) => p.position).sort()).toEqual([1, 2, 3]);
  });
});
