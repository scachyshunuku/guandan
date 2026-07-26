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
import type { CardWithWild, GameState, PlayerPosition } from "@/lib/types";
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

function callChooseGiverCard(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-giver-card`, {
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

describe("POST /api/game/[id]/choose-giver-card", () => {
  describe("single-team lead (only one giver, no cross-giver comparison needed)", () => {
    async function seedSingleLeadAwaitingChoice(gameId: string): Promise<string> {
      const gameState: GameState = {
        currentTrick: [],
        trickCount: 10,
        finishOrder: [0, 1, 3],
        pendingGiverChoice: { levelRank: "2", pendingPositions: [2], resolvedCards: {} },
      };
      const { data: round } = await fake
        .from("game_rounds")
        .insert({
          game_id: gameId,
          round_number: 1,
          game_state: gameState,
          status: "awaiting_giver_choice",
          finishing_positions: [1, 2, 4, 3],
          current_player_turn: null,
        })
        .select("id")
        .single();
      return (round as { id: string }).id;
    }

    it("applies the transfer and moves to card_exchange once the sole giver chooses", async () => {
      const gameId = await seedGame();
      const roundId = await seedSingleLeadAwaitingChoice(gameId);
      await seedParticipant(gameId, 0, "p0", []);
      await seedParticipant(gameId, 1, "p1", []);
      await seedParticipant(gameId, 2, "p2", [
        { rank: "KING", suit: "SPADES" },
        { rank: "KING", suit: "HEARTS" },
      ]);
      await seedParticipant(gameId, 3, "p3", []);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p2",
        card: { rank: "KING", suit: "HEARTS" },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ success: true });

      expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "HEARTS" }]);
      expect(handOf(gameId, 2)).toEqual([{ rank: "KING", suit: "SPADES" }]);

      const round = fake._tables.game_rounds.find((r) => r.id === roundId);
      expect(round?.status).toBe("card_exchange");
      expect((round?.game_state as GameState).pendingGiverChoice).toBeUndefined();

      expect(fake._tables.game_actions).toHaveLength(1);
      expect(fake._tables.game_actions[0]).toMatchObject({
        action_data: { from: 2, to: 0, card: { rank: "KING", suit: "HEARTS" }, type: "initial" },
      });
      expect(mockBroadcastToGame).toHaveBeenCalledWith(gameId, "round_updated", expect.anything());
    });

    it("rejects a card that isn't one of the giver's tied candidates", async () => {
      const gameId = await seedGame();
      await seedSingleLeadAwaitingChoice(gameId);
      await seedParticipant(gameId, 0, "p0", []);
      await seedParticipant(gameId, 1, "p1", []);
      await seedParticipant(gameId, 2, "p2", [
        { rank: "KING", suit: "SPADES" },
        { rank: "KING", suit: "HEARTS" },
        { rank: "3", suit: "CLUBS" },
      ]);
      await seedParticipant(gameId, 3, "p3", []);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p2",
        card: { rank: "3", suit: "CLUBS" },
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.reason).toMatch(/tied best cards/);
    });

    it("rejects a choice from someone who doesn't owe one", async () => {
      const gameId = await seedGame();
      await seedSingleLeadAwaitingChoice(gameId);
      await seedParticipant(gameId, 0, "p0", [{ rank: "3", suit: "CLUBS" }]);
      await seedParticipant(gameId, 1, "p1", []);
      await seedParticipant(gameId, 2, "p2", [
        { rank: "KING", suit: "SPADES" },
        { rank: "KING", suit: "HEARTS" },
      ]);
      await seedParticipant(gameId, 3, "p3", []);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p0",
        card: { rank: "3", suit: "CLUBS" },
      });
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.reason).toMatch(/do not owe/);
    });

    it("rejects when the round isn't awaiting a giver choice", async () => {
      const gameId = await seedGame();
      await fake.from("game_rounds").insert({
        game_id: gameId,
        round_number: 1,
        game_state: { currentTrick: [], trickCount: 0, finishOrder: [] },
        status: "in_progress",
        current_player_turn: 0,
      });
      await seedParticipant(gameId, 2, "p2", [{ rank: "KING", suit: "SPADES" }]);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p2",
        card: { rank: "KING", suit: "SPADES" },
      });
      expect(response.status).toBe(400);
    });
  });

  describe("two-team lead (two givers, may chain into a cross-giver comparison)", () => {
    async function seedTwoLeadAwaitingChoice(
      gameId: string,
      pendingPositions: PlayerPosition[],
      resolvedCards: Partial<Record<PlayerPosition, CardWithWild>> = {},
    ): Promise<string> {
      const gameState: GameState = {
        currentTrick: [],
        trickCount: 10,
        finishOrder: [0, 2],
        pendingGiverChoice: { levelRank: "2", pendingPositions, resolvedCards },
      };
      const { data: round } = await fake
        .from("game_rounds")
        .insert({
          game_id: gameId,
          round_number: 1,
          game_state: gameState,
          status: "awaiting_giver_choice",
          finishing_positions: [1, 3, 2, 4],
          current_player_turn: null,
        })
        .select("id")
        .single();
      return (round as { id: string }).id;
    }

    it("stays on 'awaiting_giver_choice' when the other giver still owes a choice", async () => {
      const gameId = await seedGame();
      const roundId = await seedTwoLeadAwaitingChoice(gameId, [1, 3]);
      await seedParticipant(gameId, 0, "p0", []);
      await seedParticipant(gameId, 1, "p1", [
        { rank: "QUEEN", suit: "SPADES" },
        { rank: "QUEEN", suit: "HEARTS" },
      ]);
      await seedParticipant(gameId, 2, "p2", []);
      await seedParticipant(gameId, 3, "p3", [
        { rank: "9", suit: "CLUBS" },
        { rank: "9", suit: "DIAMONDS" },
      ]);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p1",
        card: { rank: "QUEEN", suit: "HEARTS" },
      });
      expect(response.status).toBe(200);

      const round = fake._tables.game_rounds.find((r) => r.id === roundId);
      expect(round?.status).toBe("awaiting_giver_choice");
      expect((round?.game_state as GameState).pendingGiverChoice).toEqual({
        levelRank: "2",
        pendingPositions: [3],
        resolvedCards: { 1: { rank: "QUEEN", suit: "HEARTS" } },
      });
      // Nothing has moved yet.
      expect(handOf(gameId, 1)).toEqual([
        { rank: "QUEEN", suit: "SPADES" },
        { rank: "QUEEN", suit: "HEARTS" },
      ]);
      expect(fake._tables.game_actions ?? []).toHaveLength(0);
    });

    it("applies both transfers once the second giver's choice completes resolution and no cross-tie remains", async () => {
      const gameId = await seedGame();
      const roundId = await seedTwoLeadAwaitingChoice(gameId, [3], {
        1: { rank: "QUEEN", suit: "HEARTS" },
      });
      await seedParticipant(gameId, 0, "p0", []);
      await seedParticipant(gameId, 1, "p1", [{ rank: "3", suit: "DIAMONDS" }]);
      await seedParticipant(gameId, 2, "p2", []);
      await seedParticipant(gameId, 3, "p3", [
        { rank: "9", suit: "CLUBS" },
        { rank: "9", suit: "DIAMONDS" },
      ]);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p3",
        card: { rank: "9", suit: "CLUBS" },
      });
      expect(response.status).toBe(200);

      const round = fake._tables.game_rounds.find((r) => r.id === roundId);
      expect(round?.status).toBe("card_exchange");
      expect((round?.game_state as GameState).pendingGiverChoice).toBeUndefined();

      // Queen (position 1) outranks 9 (position 3): higher to 1st, lower to 2nd.
      expect(handOf(gameId, 0)).toEqual([{ rank: "QUEEN", suit: "HEARTS" }]);
      expect(handOf(gameId, 2)).toEqual([{ rank: "9", suit: "CLUBS" }]);
      expect(fake._tables.game_actions).toHaveLength(2);
    });

    it("hands off to 'awaiting_tribute_choice' when the resolved cards still tie with each other", async () => {
      const gameId = await seedGame();
      const roundId = await seedTwoLeadAwaitingChoice(gameId, [1], {
        3: { rank: "9", suit: "DIAMONDS" },
      });
      await seedParticipant(gameId, 0, "p0", []);
      await seedParticipant(gameId, 1, "p1", [
        { rank: "9", suit: "CLUBS" },
        { rank: "9", suit: "SPADES" },
      ]);
      await seedParticipant(gameId, 2, "p2", []);
      await seedParticipant(gameId, 3, "p3", [{ rank: "9", suit: "DIAMONDS" }]);

      const response = await callChooseGiverCard(gameId, {
        playerId: "p1",
        card: { rank: "9", suit: "CLUBS" },
      });
      expect(response.status).toBe(200);

      const round = fake._tables.game_rounds.find((r) => r.id === roundId);
      expect(round?.status).toBe("awaiting_tribute_choice");
      expect((round?.game_state as GameState).pendingTributeChoice).toEqual({
        thirdPosition: 1,
        thirdCard: { rank: "9", suit: "CLUBS" },
        fourthPosition: 3,
        fourthCard: { rank: "9", suit: "DIAMONDS" },
      });
      // Nothing has changed hands yet - that waits on choose-tribute.
      expect(fake._tables.game_actions ?? []).toHaveLength(0);
    });
  });
});
