/**
 * @jest-environment node
 */
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { seedBotMatch } from "./seedBotMatch";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

describe("seedBotMatch", () => {
  it("seats 4 bots, marks them is_bot, and starts the game", async () => {
    const { gameId, bots } = await seedBotMatch();

    expect(bots).toHaveLength(4);
    expect(bots.map((b) => b.position).sort()).toEqual([0, 1, 2, 3]);

    const participants = fake._tables.game_participants.filter((p) => p.game_id === gameId);
    expect(participants).toHaveLength(4);
    expect(participants.every((p) => p.is_bot === true)).toBe(true);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.status).toBe("in_progress");
  });

  it("throws rather than silently starting the game if the is_bot update fails", async () => {
    // The is_bot UPDATE is the first game_participants:update op seedBotMatch
    // issues (the 4 joins that precede it are inserts) — failing "the next
    // one" targets exactly that write.
    fake._failNext("game_participants", "update");

    await expect(seedBotMatch()).rejects.toThrow(/failed to mark participants as bots/);

    // The game must never have been started on this failure path — a
    // mismarked-but-still-played bot game is exactly what the throw exists
    // to prevent.
    const games = fake._tables.games ?? [];
    expect(games.every((g) => g.status !== "in_progress")).toBe(true);
  });
});
