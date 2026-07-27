/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CreateGameResponse } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

describe("POST /api/game/create", () => {
  it("creates a waiting game with no round yet (start/route.ts deals round 1)", async () => {
    const response = await POST();
    expect(response.status).toBe(201);

    const body = (await response.json()) as CreateGameResponse;
    expect(body.gameId).toEqual(expect.any(String));

    expect(fake._tables.games).toHaveLength(1);
    expect(fake._tables.games[0]).toMatchObject({
      id: body.gameId,
      status: "waiting",
      team_a_level: 2,
      team_b_level: 2,
    });

    expect(fake._tables.game_rounds ?? []).toHaveLength(0);
  });

  it("creates a fresh game (and code) on each call", async () => {
    const first = (await (await POST()).json()) as CreateGameResponse;
    const second = (await (await POST()).json()) as CreateGameResponse;
    expect(first.gameId).not.toEqual(second.gameId);
    expect(fake._tables.games).toHaveLength(2);
  });
});
