/**
 * @jest-environment node
 */
// Exercises create -> join x4 (+1 spectator) -> start end-to-end against the
// same fake Supabase instance, per IMPLEMENTATION.md Task 3.1's "full game
// setup" test bullet. Runs in the node environment (rather than this
// repo's default jsdom) because the routes it calls import NextResponse
// from next/server, which needs the Fetch API's Request/Response globals.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  CreateGameResponse,
  JoinGameResponse,
  StartGameResponse,
} from "@/lib/types";
import { create as createGame, join, start } from "@/testUtils/gameRouteHelpers";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

describe("full game setup", () => {
  it("takes a game from creation through 4 joins, a spectator, and start", async () => {
    const { gameId } = (await (await createGame()).json()) as CreateGameResponse;

    const joinResults: JoinGameResponse[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await join(gameId, `Player ${i}`, `p${i}`);
      joinResults.push((await response.json()) as JoinGameResponse);
    }
    for (let i = 0; i < 4; i++) {
      expect(joinResults[i]).toEqual({ spectator: false, position: i, hand: [] });
    }

    const spectatorResponse = await join(gameId, "Watcher", "watcher");
    expect(await spectatorResponse.json()).toEqual({ spectator: true });

    // A non-seated player can't start the game.
    const rejected = await start(gameId, "watcher");
    expect(rejected.status).toBe(403);

    const startResponse = await start(gameId, "p0");
    expect(startResponse.status).toBe(200);
    const startBody = (await startResponse.json()) as StartGameResponse;
    expect(startBody.hand).toHaveLength(27);

    const gameRow = fake._tables.games.find((g) => g.id === gameId);
    expect(gameRow?.status).toBe("in_progress");

    const seatedHands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId && p.position !== null)
      .map((p) => p.hand as unknown[]);
    expect(seatedHands).toHaveLength(4);
    for (const hand of seatedHands) expect(hand).toHaveLength(27);
    expect(seatedHands.flat()).toHaveLength(108);

    const spectatorRow = fake._tables.game_participants.find(
      (p) => p.player_id === "watcher",
    );
    expect(spectatorRow?.hand).toEqual([]);
  });
});
