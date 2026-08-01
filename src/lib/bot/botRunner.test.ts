/**
 * @jest-environment node
 */
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { GameState } from "@/lib/types";
import { driveBotGame, driveOneBotAction } from "./botRunner";

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

async function seedRound(gameId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  await fake.from("game_rounds").insert({
    game_id: gameId,
    round_number: 1,
    game_state: gameState,
    leader_position: 0,
    current_player_turn: 0,
    ...overrides,
  });
}

async function seedParticipant(
  gameId: string,
  position: number,
  playerId: string,
  isBot = true,
): Promise<void> {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
    hand: [{ rank: "7", suit: "CLUBS" }],
    is_bot: isBot,
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

describe("driveOneBotAction", () => {
  it("is idle when it's a human's turn (mixed human+bot game)", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 0 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);

    const step = await driveOneBotAction(gameId, [{ position: 1, playerId: "bot1" }]);
    expect(step).toEqual({ kind: "idle", reason: expect.any(String) });

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect((round?.game_state as GameState).currentTrick).toEqual([]);
  });

  it("acts for the bot whose turn it actually is", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 1 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);

    const step = await driveOneBotAction(gameId, [{ position: 1, playerId: "bot1" }]);
    expect(step).toEqual({ kind: "acted" });

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      { position: 1, play: [{ rank: "7", suit: "CLUBS" }] },
    ]);
  });

  it("reports completed once the game is done", async () => {
    const gameId = await seedGame({ status: "completed" });
    const step = await driveOneBotAction(gameId, [{ position: 0, playerId: "bot0" }]);
    expect(step).toEqual({ kind: "completed" });
  });

  it("is idle (not an error) for a game still waiting to start", async () => {
    const gameId = await seedGame({ status: "waiting" });
    const step = await driveOneBotAction(gameId, [{ position: 0, playerId: "bot0" }]);
    expect(step).toEqual({ kind: "idle", reason: expect.any(String) });
  });

  it("acts for a bot's pending giver choice even when a human's own pending choice sorts first", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, {
      status: "awaiting_giver_choice",
      game_state: {
        currentTrick: [],
        trickCount: 0,
        finishOrder: [],
        pendingGiverChoice: {
          levelRank: "2",
          pendingPositions: [0, 1], // 0 = human (sorts first), 1 = bot
          resolvedCards: {},
        },
      },
    });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);

    const step = await driveOneBotAction(gameId, [{ position: 1, playerId: "bot1" }]);
    expect(step).toEqual({ kind: "acted" });

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    const pending = (round?.game_state as GameState).pendingGiverChoice;
    expect(pending?.pendingPositions).toEqual([0]); // only the bot's choice resolved
  });

  it("acts for a bot's pending card-exchange return even when a human's own return is owed first", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { status: "card_exchange", leader_position: 0 });
    await seedParticipant(gameId, 0, "human", false);
    await seedParticipant(gameId, 1, "bot1", true);
    await seedParticipant(gameId, 2, "p2", false);
    await seedParticipant(gameId, 3, "p3", false);
    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId)!;
    // Position 0 (human) owes a return to 2, position 1 (bot) owes a return
    // to 3 - both pending, human's listed first.
    await fake.from("game_actions").insert([
      {
        game_id: gameId,
        round_id: round.id,
        player_id: "someone",
        action_type: "card_exchange",
        action_data: { from: 2, to: 0, card: { rank: "3", suit: "CLUBS" }, type: "initial" },
      },
      {
        game_id: gameId,
        round_id: round.id,
        player_id: "someone",
        action_type: "card_exchange",
        action_data: { from: 3, to: 1, card: { rank: "4", suit: "CLUBS" }, type: "initial" },
      },
    ]);

    const step = await driveOneBotAction(gameId, [{ position: 1, playerId: "bot1" }]);
    expect(step).toEqual({ kind: "acted" });

    const returnActions = fake._tables.game_actions.filter(
      (a) => a.game_id === gameId && (a.action_data as { type: string }).type === "return",
    );
    expect(returnActions).toHaveLength(1);
    expect(returnActions[0].action_data).toMatchObject({ from: 1, to: 3 });
  });
});
