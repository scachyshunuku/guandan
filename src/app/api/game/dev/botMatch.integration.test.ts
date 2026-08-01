/**
 * @jest-environment node
 */
// Full bot-vs-bot game (IMPLEMENTATION.md Phase 7), against the same fake
// Supabase instance every other route-level integration test in this
// codebase uses (see fullGameSetup.integration.test.ts). Exercises the dev
// route end to end: seeding a fresh all-bot game and driving it all the way
// to `status: 'completed'`, calling the exact same lib/gameActions
// functions a human's HTTP requests would. Run a handful of times since
// dealing is randomized — a hang (the failure mode this tool exists to
// catch) could otherwise slip through on an unlucky single run.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { POST as botMatchRoute } from "./bot-match/route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

jest.setTimeout(30_000);

beforeEach(() => {
  fake._reset();
});

describe("POST /api/game/dev/bot-match", () => {
  it.each([1, 2, 3])("drives a full bot-vs-bot game to completion (run %i)", async () => {
    const response = await botMatchRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      gameId: string;
      outcome: string;
      iterations: number;
      finalState: { status: string; teamALevel: number; teamBLevel: number } | null;
    };

    expect(body.outcome).toBe("completed");
    expect(body.finalState?.status).toBe("completed");
    expect(Math.max(body.finalState!.teamALevel, body.finalState!.teamBLevel)).toBe(14);

    const participants = fake._tables.game_participants.filter((p) => p.game_id === body.gameId);
    expect(participants).toHaveLength(4);
    expect(participants.every((p) => p.is_bot === true)).toBe(true);
  });
});
