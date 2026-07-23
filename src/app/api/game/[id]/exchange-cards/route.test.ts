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
import type {
  CardExchangeActionData,
  CardWithWild,
  ExchangeCardsResponse,
  GameState,
  PlayerPosition,
} from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<typeof broadcastToGame>;

beforeEach(() => {
  fake._reset();
  jest.restoreAllMocks();
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

async function seedRound(
  gameId: string,
  finishingPositions: number[],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = { currentTrick: [], trickCount: 27, finishOrder: [] };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 1,
      game_state: gameState,
      status: "card_exchange",
      finishing_positions: finishingPositions,
      current_player_turn: null,
      ...overrides,
    })
    .select("id")
    .single();
  return (round as { id: string }).id;
}

async function seedParticipant(
  gameId: string,
  position: number | null,
  playerId: string,
  hand: CardWithWild[] = [],
) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
    hand,
  });
}

async function seedInitialExchange(
  gameId: string,
  roundId: string,
  from: PlayerPosition,
  to: PlayerPosition,
  card: CardWithWild,
) {
  const actionData: CardExchangeActionData = { from, to, card, type: "initial" };
  await fake.from("game_actions").insert({
    game_id: gameId,
    round_id: roundId,
    player_id: "system",
    action_type: "card_exchange",
    action_data: actionData,
  });
}

function callExchange(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/exchange-cards`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

function handOf(gameId: string, position: number) {
  return fake._tables.game_participants.find(
    (p) => p.game_id === gameId && p.position === position,
  )?.hand as CardWithWild[] | undefined;
}

describe("POST /api/game/[id]/exchange-cards", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callExchange("does-not-exist", {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(404);
  });

  it("rejects a round that isn't in the card exchange phase", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, [1, 2, 4, 3], { status: "in_progress" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "3", suit: "HEARTS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a playerId that doesn't match the claimed position", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 1,
      cardToGive: { rank: "KING", suit: "CLUBS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(403);
  });

  it("rejects an 'initial' type submission — that half is automatic", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "initial",
      recipientPosition: 2,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ExchangeCardsResponse;
    expect(body).toMatchObject({ success: false });
  });

  it("rejects a player who didn't receive a card in the initial exchange", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 1, "p1", [{ rank: "3", suit: "HEARTS" }]);

    const response = await callExchange(gameId, {
      playerId: "p1",
      position: 1,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ExchangeCardsResponse;
    expect(body).toMatchObject({ success: false, reason: expect.stringContaining("did not receive") });
  });

  it("rejects a recipientPosition that doesn't match who gave the card", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }, { rank: "3", suit: "HEARTS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 1, // should be 2 (who actually gave the card)
    });
    expect(response.status).toBe(400);
  });

  it("rejects a card the player doesn't hold", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "9", suit: "DIAMONDS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a second return submission from the same player", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedInitialExchange(gameId, roundId, 0, 2, { rank: "3", suit: "HEARTS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }, { rank: "4", suit: "SPADES" }]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const first = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "4", suit: "SPADES" },
      type: "return",
      recipientPosition: 2,
    });
    expect(first.status).toBe(200);

    const second = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "KING", suit: "CLUBS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(second.status).toBe(409);
  });

  it("single-team-lead: one return completes the round and deals the next", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]); // position 0 finished 1st
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const oldRound = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(oldRound?.status).toBe("completed");

    // The single return needed completes the round immediately, so the
    // fresh 27-card deal below overwrites the just-exchanged hands right
    // away — the return's effect is only observable via the action log,
    // not by inspecting hands afterward.
    const returnAction = fake._tables.game_actions.find(
      (a) => a.action_type === "card_exchange" && (a.action_data as CardExchangeActionData).type === "return",
    );
    expect(returnAction).toMatchObject({
      action_data: { from: 0, to: 2, card: { rank: "3", suit: "HEARTS" }, type: "return" },
    });

    const newRound = fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
    expect(newRound).toBeDefined();
    expect(newRound?.leader_position).toBe(0); // 1st place leads the next hand
    expect(newRound?.current_player_turn).toBe(0);
    expect(newRound?.game_state).toEqual({ currentTrick: [], trickCount: 0, finishOrder: [] });

    const dealtHands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .map((p) => p.hand as unknown[]);
    for (const hand of dealtHands) expect(hand).toHaveLength(27);
    expect(dealtHands.flat()).toHaveLength(108);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "card_exchange" }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({ id: newRound?.id, round_number: 2 }),
    );
  });

  it("two-team-lead: the round stays open until both owed returns are submitted", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 3, 2, 4]); // 0=1st, 2=2nd, 1=3rd, 3=4th
    await seedInitialExchange(gameId, roundId, 3, 0, { rank: "QUEEN", suit: "SPADES" });
    await seedInitialExchange(gameId, roundId, 1, 2, { rank: "9", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "QUEEN", suit: "SPADES" },
      { rank: "5", suit: "DIAMONDS" },
    ]);
    await seedParticipant(gameId, 1, "p1", [{ rank: "3", suit: "DIAMONDS" }]);
    await seedParticipant(gameId, 2, "p2", [
      { rank: "9", suit: "CLUBS" },
      { rank: "6", suit: "DIAMONDS" },
    ]);
    await seedParticipant(gameId, 3, "p3", [{ rank: "4", suit: "DIAMONDS" }]);

    const firstReturn = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "5", suit: "DIAMONDS" },
      type: "return",
      recipientPosition: 3,
    });
    expect(firstReturn.status).toBe(200);

    let round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange"); // still waiting on position 2's return
    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(1);

    const secondReturn = await callExchange(gameId, {
      playerId: "p2",
      position: 2,
      cardToGive: { rank: "6", suit: "DIAMONDS" },
      type: "return",
      recipientPosition: 1,
    });
    expect(secondReturn.status).toBe(200);

    round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("completed");
    const newRound = fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
    expect(newRound).toBeDefined();
    expect(newRound?.leader_position).toBe(0);
  });

  it("lets two near-simultaneous final returns both succeed without dealing two next rounds", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 3, 2, 4]);
    await seedInitialExchange(gameId, roundId, 3, 0, { rank: "QUEEN", suit: "SPADES" });
    await seedInitialExchange(gameId, roundId, 1, 2, { rank: "9", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "QUEEN", suit: "SPADES" },
      { rank: "5", suit: "DIAMONDS" },
    ]);
    await seedParticipant(gameId, 1, "p1", [{ rank: "3", suit: "DIAMONDS" }]);
    await seedParticipant(gameId, 2, "p2", [
      { rank: "9", suit: "CLUBS" },
      { rank: "6", suit: "DIAMONDS" },
    ]);
    await seedParticipant(gameId, 3, "p3", [{ rank: "4", suit: "DIAMONDS" }]);

    const [r1, r2] = await Promise.all([
      callExchange(gameId, {
        playerId: "p0",
        position: 0,
        cardToGive: { rank: "5", suit: "DIAMONDS" },
        type: "return",
        recipientPosition: 3,
      }),
      callExchange(gameId, {
        playerId: "p2",
        position: 2,
        cardToGive: { rank: "6", suit: "DIAMONDS" },
        type: "return",
        recipientPosition: 1,
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("completed");

    const nextRounds = fake._tables.game_rounds.filter((r) => r.game_id === gameId && r.round_number === 2);
    expect(nextRounds).toHaveLength(1);
  });

  it("rolls back the hand transfer if the action log write fails", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);
    fake._failNext("game_actions", "insert");

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(500);

    expect(handOf(gameId, 0)).toEqual([
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "7", suit: "HEARTS" }]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
  });

  it("deletes the action row too if a hand update fails, so a retry isn't locked out by 'already submitted'", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);
    // Fails the *first* game_participants update (the caller's own hand
    // write) while the action insert — later in the same Promise.all —
    // still succeeds, exercising the "action row outlives its sibling
    // write" case.
    fake._failNext("game_participants", "update");

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(500);

    expect(fake._tables.game_actions.filter((a) => a.action_type === "card_exchange" && (a.action_data as CardExchangeActionData).type === "return")).toHaveLength(0);
    expect(handOf(gameId, 0)).toEqual([
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "7", suit: "HEARTS" }]);

    // A retry isn't blocked by a phantom "already submitted" 409.
    const retry = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(retry.status).toBe(200);
  });

  it("rolls back the round, the new round, and dealt hands if dealing the next round's cards fails partway", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", [{ rank: "5", suit: "SPADES" }]);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", [{ rank: "6", suit: "CLUBS" }]);

    // Let the return exchange's own two hand updates (caller + recipient)
    // succeed normally, and only fail once dealing the next round's four
    // hands begins — `_failNext` only ever fails the *next* matching call,
    // so target a specific later one by counting `game_participants`
    // updates, same technique as play-cards/route.test.ts's
    // "does not stomp a legitimate next player's committed turn" test.
    let updateCalls = 0;
    const originalFrom = fake.from.bind(fake);
    jest.spyOn(fake, "from").mockImplementation((table: string) => {
      const builder = originalFrom(table);
      if (table === "game_participants") {
        const originalUpdate = builder.update.bind(builder);
        builder.update = ((payload: unknown) => {
          updateCalls += 1;
          // Calls 1-2 are the return exchange's own caller/recipient
          // writes; calls 3-6 are the four deal writes — fail the 3rd of
          // those.
          if (updateCalls === 5) {
            fake._failNext("game_participants", "update");
          }
          return originalUpdate(payload);
        }) as typeof builder.update;
      }
      return builder;
    });

    const response = await callExchange(gameId, {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    });
    expect(response.status).toBe(500);

    // The round-1 finalization is fully rolled back...
    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    expect(round?.finishing_positions).toEqual([1, 2, 4, 3]);
    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(1);

    // ...but the return exchange itself, which had already committed
    // before dealing even started, is left intact rather than also undone.
    expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([
      { rank: "7", suit: "HEARTS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    expect(handOf(gameId, 1)).toEqual([{ rank: "5", suit: "SPADES" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "6", suit: "CLUBS" }]);
  });

  it("retries a stuck finalization on re-submission, instead of 409ing forever once every return is already in", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [1, 2, 4, 3]); // single-team-lead: only 1 return owed
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", [{ rank: "5", suit: "SPADES" }]);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", [{ rank: "6", suit: "CLUBS" }]);

    // Fail only the first of the four deal writes triggered by this one
    // (and only) owed return, so finalization fails on the first attempt.
    let updateCalls = 0;
    const originalFrom = fake.from.bind(fake);
    const spy = jest.spyOn(fake, "from").mockImplementation((table: string) => {
      const builder = originalFrom(table);
      if (table === "game_participants") {
        const originalUpdate = builder.update.bind(builder);
        builder.update = ((payload: unknown) => {
          updateCalls += 1;
          if (updateCalls === 3) {
            fake._failNext("game_participants", "update");
          }
          return originalUpdate(payload);
        }) as typeof builder.update;
      }
      return builder;
    });

    const body = {
      playerId: "p0",
      position: 0,
      cardToGive: { rank: "3", suit: "HEARTS" },
      type: "return",
      recipientPosition: 2,
    };

    const first = await callExchange(gameId, body);
    expect(first.status).toBe(500);

    let round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    // The return itself is recorded exactly once — this isn't a case where
    // the return failed, only the finalize-and-deal step that followed it.
    expect(
      fake._tables.game_actions.filter(
        (a) => a.action_type === "card_exchange" && (a.action_data as CardExchangeActionData).type === "return",
      ),
    ).toHaveLength(1);

    spy.mockRestore();

    // Re-submitting the identical return would normally 409 as a duplicate
    // — but since it's the only owed return and it's already recorded, this
    // retries the stuck finalize instead, with no injected failure this time.
    const retry = await callExchange(gameId, body);
    expect(retry.status).toBe(200);

    round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("completed");
    const newRound = fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
    expect(newRound).toBeDefined();
    expect(newRound?.leader_position).toBe(0);
  });
});
