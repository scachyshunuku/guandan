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
import type { CardWithWild, GameState } from "@/lib/types";
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

// Position 0 finished 1st, 2 finished 2nd, 1 (3rd) and 3 (4th) tied on the
// tribute card (RULES.md "Two-Team Lead") — matches end-hand/route.ts's
// pendingTributeChoice shape for a [0, 2] 1-2 finish.
async function seedAwaitingChoiceRound(
  gameId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = {
    currentTrick: [],
    trickCount: 10,
    finishOrder: [0, 2],
    pendingTributeChoice: {
      thirdPosition: 1,
      thirdCard: { rank: "9", suit: "CLUBS" },
      fourthPosition: 3,
      fourthCard: { rank: "9", suit: "SPADES" },
    },
  };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 1,
      game_state: gameState,
      status: "awaiting_tribute_choice",
      finishing_positions: [1, 3, 2, 4],
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

function callChooseTribute(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-tribute`, {
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

async function seedStandardParticipants(gameId: string) {
  await seedParticipant(gameId, 0, "p0", []);
  await seedParticipant(gameId, 1, "p1", [
    { rank: "9", suit: "CLUBS" },
    { rank: "3", suit: "DIAMONDS" },
  ]);
  await seedParticipant(gameId, 2, "p2", []);
  await seedParticipant(gameId, 3, "p3", [
    { rank: "9", suit: "SPADES" },
    { rank: "4", suit: "DIAMONDS" },
  ]);
}

describe("POST /api/game/[id]/choose-tribute", () => {
  it("1st place taking 3rd's card: sends it to 1st and 4th's card to 2nd", async () => {
    const gameId = await seedGame();
    const roundId = await seedAwaitingChoiceRound(gameId);
    await seedStandardParticipants(gameId);

    const response = await callChooseTribute(gameId, { playerId: "p0", take: 1 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });

    expect(handOf(gameId, 0)).toEqual([{ rank: "9", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "9", suit: "SPADES" }]);
    expect(handOf(gameId, 1)).toEqual([{ rank: "3", suit: "DIAMONDS" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "4", suit: "DIAMONDS" }]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    expect((round?.game_state as GameState).pendingTributeChoice).toBeUndefined();

    expect(fake._tables.game_actions).toHaveLength(2);
    expect(fake._tables.game_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_data: { from: 1, to: 0, card: { rank: "9", suit: "CLUBS" }, type: "initial" },
        }),
        expect.objectContaining({
          action_data: { from: 3, to: 2, card: { rank: "9", suit: "SPADES" }, type: "initial" },
        }),
      ]),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(gameId, "round_updated", expect.anything());
  });

  it("1st place taking 4th's card: sends it to 1st and 3rd's card to 2nd", async () => {
    const gameId = await seedGame();
    await seedAwaitingChoiceRound(gameId);
    await seedStandardParticipants(gameId);

    const response = await callChooseTribute(gameId, { playerId: "p0", take: 3 });
    expect(response.status).toBe(200);

    expect(handOf(gameId, 0)).toEqual([{ rank: "9", suit: "SPADES" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "9", suit: "CLUBS" }]);
  });

  it("rejects a choice from anyone other than 1st place", async () => {
    const gameId = await seedGame();
    await seedAwaitingChoiceRound(gameId);
    await seedStandardParticipants(gameId);

    const response = await callChooseTribute(gameId, { playerId: "p2", take: 1 });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.reason).toMatch(/1st place/);
  });

  it("rejects a take that isn't one of the two tied positions", async () => {
    const gameId = await seedGame();
    await seedAwaitingChoiceRound(gameId);
    await seedStandardParticipants(gameId);

    const response = await callChooseTribute(gameId, { playerId: "p0", take: 2 });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.reason).toMatch(/tied positions/);
  });

  it("rejects when the round isn't awaiting a tribute choice", async () => {
    const gameId = await seedGame();
    await fake
      .from("game_rounds")
      .insert({
        game_id: gameId,
        round_number: 1,
        game_state: { currentTrick: [], trickCount: 0, finishOrder: [] },
        status: "in_progress",
        current_player_turn: 0,
      });
    await seedStandardParticipants(gameId);

    const response = await callChooseTribute(gameId, { playerId: "p0", take: 1 });
    expect(response.status).toBe(400);
  });

  it("rejects a resubmission once the choice has already been resolved (round has moved on to 'card_exchange')", async () => {
    const gameId = await seedGame();
    await seedAwaitingChoiceRound(gameId);
    await seedStandardParticipants(gameId);

    const first = await callChooseTribute(gameId, { playerId: "p0", take: 1 });
    expect(first.status).toBe(200);

    const second = await callChooseTribute(gameId, { playerId: "p0", take: 1 });
    expect(second.status).toBe(400);
  });
});
