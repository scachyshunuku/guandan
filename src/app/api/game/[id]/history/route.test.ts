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
import type { GameActionsResponse } from "@/lib/types";
import { GET } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

function callHistory(gameId: string) {
  const request = new NextRequest(`http://localhost/api/game/${gameId}/history`);
  return GET(request, { params: Promise.resolve({ id: gameId }) });
}

describe("GET /api/game/[id]/history", () => {
  it("returns recorded actions for a real game", async () => {
    const { data: game } = await fake.from("games").insert({}).select("id").single();
    const gameId = (game as { id: string }).id;
    await fake.from("game_actions").insert({
      game_id: gameId,
      round_id: "round-1",
      player_id: "p0",
      action_type: "join",
      action_data: { playerName: "Alice", position: 0 },
    });

    const response = await callHistory(gameId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GameActionsResponse;
    expect(body.actions).toHaveLength(1);
  });

  it("returns an empty list for a well-formed but nonexistent game", async () => {
    const response = await callHistory("00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actions: [] });
  });

  it("400s (not a 500, and not a silently-empty 200) for a malformed game id", async () => {
    const response = await callHistory("does-not-exist");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid game id" });
  });
});
