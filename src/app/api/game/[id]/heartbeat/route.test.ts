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
import { HEARTBEAT_STALE_MS } from "@/lib/presence";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<typeof broadcastToGame>;

beforeEach(() => {
  fake._reset();
  mockBroadcastToGame.mockClear();
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

function callHeartbeat(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/heartbeat`, {
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

describe("POST /api/game/[id]/heartbeat", () => {
  it("marks the caller connected and refreshes their heartbeat", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", {
      is_connected: false,
      last_heartbeat: new Date(Date.now() - HEARTBEAT_STALE_MS * 10).toISOString(),
    });

    const before = Date.now();
    const response = await callHeartbeat(gameId, { playerId: "alice" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });

    const row = participantRow(gameId, "alice")!;
    expect(row.is_connected).toBe(true);
    expect(Date.parse(row.last_heartbeat as string)).toBeGreaterThanOrEqual(before);
  });

  it("sweeps another participant's stale heartbeat to disconnected and broadcasts it", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { position: 0 });
    await seedParticipant(gameId, "bob", {
      position: 1,
      is_connected: true,
      last_heartbeat: new Date(Date.now() - HEARTBEAT_STALE_MS * 10).toISOString(),
    });

    await callHeartbeat(gameId, { playerId: "alice" });

    const bobRow = participantRow(gameId, "bob")!;
    expect(bobRow.is_connected).toBe(false);
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "participant_updated",
      expect.objectContaining({ player_id: "bob", is_connected: false, hand: [] }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "participant_updated",
      expect.objectContaining({ player_id: "alice", is_connected: true }),
    );
  });

  it("does not sweep another participant whose heartbeat is still recent", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { position: 0 });
    await seedParticipant(gameId, "bob", {
      position: 1,
      is_connected: true,
      last_heartbeat: new Date().toISOString(),
    });

    await callHeartbeat(gameId, { playerId: "alice" });

    const bobRow = participantRow(gameId, "bob")!;
    expect(bobRow.is_connected).toBe(true);
  });

  it("never leaks a hand in the broadcast payload", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { hand: [{ rank: "ACE", suit: "SPADES" }] });

    await callHeartbeat(gameId, { playerId: "alice" });

    for (const call of mockBroadcastToGame.mock.calls) {
      expect((call[2] as { hand: unknown[] }).hand).toEqual([]);
    }
  });

  it("never leaks a hand_order in the broadcast payload", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice", { hand_order: ["AS#0"] });
    await seedParticipant(gameId, "bob", {
      position: 1,
      hand_order: ["KH#0"],
      is_connected: true,
      last_heartbeat: new Date(Date.now() - HEARTBEAT_STALE_MS * 10).toISOString(),
    });

    await callHeartbeat(gameId, { playerId: "alice" });

    expect(mockBroadcastToGame.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockBroadcastToGame.mock.calls) {
      expect((call[2] as { hand_order: unknown }).hand_order).toBeNull();
    }
  });

  it("rejects when playerId is missing", async () => {
    const gameId = await seedGame();
    const response = await callHeartbeat(gameId, {});
    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent game", async () => {
    const response = await callHeartbeat("00000000-0000-0000-0000-000000000000", {
      playerId: "alice",
    });
    expect(response.status).toBe(404);
  });

  it("rejects a playerId that isn't a participant in this game", async () => {
    const gameId = await seedGame();
    await seedParticipant(gameId, "alice");
    const response = await callHeartbeat(gameId, { playerId: "someone-else" });
    expect(response.status).toBe(403);
  });
});
