/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import { NextRequest } from "next/server";
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameStateResponse } from "@/lib/types";
import { GET } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

function callGet(gameId: string, playerId?: string) {
  const url = new URL(`http://localhost/api/game/${gameId}`);
  if (playerId) url.searchParams.set("playerId", playerId);
  const request = new NextRequest(url);
  return GET(request, { params: Promise.resolve({ id: gameId }) });
}

describe("GET /api/game/[id]", () => {
  it("returns the current state for a real game", async () => {
    const { data: game } = await fake.from("games").insert({}).select("id").single();
    const gameId = (game as { id: string }).id;
    await fake.from("game_rounds").insert({
      game_id: gameId,
      round_number: 1,
      game_state: { currentTrick: [], trickCount: 0 },
    });

    const response = await callGet(gameId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GameStateResponse;
    expect(body.game.id).toBe(gameId);
  });

  it("404s for a well-formed but nonexistent game", async () => {
    const response = await callGet("00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
  });

  it("404s (not a 500) for a malformed game id", async () => {
    const response = await callGet("does-not-exist");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Game not found" });
  });
});
