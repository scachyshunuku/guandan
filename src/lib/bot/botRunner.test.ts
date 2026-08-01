/**
 * @jest-environment node
 */
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameState } from "@/lib/types";
import { driveBotGame } from "./botRunner";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

async function seedGame(): Promise<string> {
  const { data: game } = await fake.from("games").insert({ status: "in_progress" }).select("id").single();
  return (game as { id: string }).id;
}

async function seedRound(gameId: string): Promise<void> {
  const gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  await fake.from("game_rounds").insert({
    game_id: gameId,
    round_number: 1,
    game_state: gameState,
    leader_position: 0,
    current_player_turn: 0,
  });
}

async function seedParticipant(gameId: string, position: number, playerId: string): Promise<void> {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
    hand: [{ rank: "7", suit: "CLUBS" }],
    is_bot: true,
  });
}

describe("driveBotGame", () => {
  it("fails fast with a diagnostic reason when a dispatched action errors, instead of looping to the iteration cap", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 0, "b0");

    // The acting bot leads (currentTrick is empty), which dispatches
    // playCards -> a game_rounds CAS update. Failing that update makes
    // playCards return a 500 ActionResult, which driveBotGame must surface
    // immediately rather than silently re-looping.
    fake._failNext("game_rounds", "update");

    const result = await driveBotGame(gameId, [{ position: 0, playerId: "b0" }], 100);

    expect(result).toEqual({
      outcome: "stalled",
      iterations: 0,
      reason: expect.stringContaining("bot action failed with status 500"),
    });
  });
});
