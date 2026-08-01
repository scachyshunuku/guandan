/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

async function seedParticipant(
  gameId: string,
  playerId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await fake
    .from("game_participants")
    .insert({
      game_id: gameId,
      player_name: playerId,
      player_id: playerId,
      position: 0,
      ...overrides,
    })
    .select("id")
    .single();
  return (data as { id: string }).id;
}

function callHandOrder(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/hand-order`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

function participantRow(gameId: string, playerId: string) {
  return fake._tables.game_participants.find(
    (p) => p.game_id === gameId && p.player_id === playerId,
  );
}

describe("POST /api/game/[id]/hand-order", () => {
  it("saves the caller's hand order", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");

    const response = await callHandOrder(gameId, { playerId: "alice", order: ["7H#0", "3C#0"] });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });
    expect(participantRow(gameId, "alice")!.hand_order).toEqual(["7H#0", "3C#0"]);
  });

  it("overwrites a previously saved order", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { hand_order: ["3C#0", "7H#0"] });

    await callHandOrder(gameId, { playerId: "alice", order: ["7H#0", "3C#0"] });

    expect(participantRow(gameId, "alice")!.hand_order).toEqual(["7H#0", "3C#0"]);
  });

  it("does not touch another participant's hand order", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { position: 0 });
    await seedParticipant(gameId, "bob", { position: 1, hand_order: ["3C#0"] });

    await callHandOrder(gameId, { playerId: "alice", order: ["7H#0"] });

    expect(participantRow(gameId, "bob")!.hand_order).toEqual(["3C#0"]);
  });

  it("accepts an empty array to reset to natural order", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { hand_order: ["3C#0"] });

    const response = await callHandOrder(gameId, { playerId: "alice", order: [] });

    expect(response.status).toBe(200);
    expect(participantRow(gameId, "alice")!.hand_order).toEqual([]);
  });

  it("rejects when playerId is missing", async () => {
    const gameId = await seedGame();
    const response = await callHandOrder(gameId, { order: ["7H#0"] });
    expect(response.status).toBe(400);
  });

  it("rejects when order is missing", async () => {
    const gameId = await seedGame();
    const response = await callHandOrder(gameId, { playerId: "alice" });
    expect(response.status).toBe(400);
  });

  it("rejects a non-array order", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHandOrder(gameId, { playerId: "alice", order: "7H#0" });
    expect(response.status).toBe(400);
  });

  it("rejects an order containing a non-string entry", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHandOrder(gameId, { playerId: "alice", order: ["7H#0", 5] });
    expect(response.status).toBe(400);
  });

  it("rejects an order that's longer than a real hand could ever be", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHandOrder(gameId, {
      playerId: "alice",
      order: Array.from({ length: 201 }, (_, i) => `${i}`),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unreasonably long individual key", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHandOrder(gameId, {
      playerId: "alice",
      order: ["x".repeat(33)],
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent game", async () => {
    const response = await callHandOrder("00000000-0000-0000-0000-000000000000", {
      playerId: "alice",
      order: [],
    });
    expect(response.status).toBe(404);
  });

  it("rejects a playerId that isn't a participant in this game", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHandOrder(gameId, { playerId: "someone-else", order: [] });
    expect(response.status).toBe(403);
  });
});
