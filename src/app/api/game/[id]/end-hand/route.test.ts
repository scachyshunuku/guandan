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
  finishOrder: PlayerPosition[],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = { currentTrick: [], trickCount: 10, finishOrder };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 1,
      game_state: gameState,
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

function callEndHand(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/end-hand`, {
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

describe("POST /api/game/[id]/end-hand", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callEndHand("does-not-exist", { playerId: "p0" });
    expect(response.status).toBe(404);
  });

  it("rejects a game that hasn't started", async () => {
    const gameId = await seedGame({ status: "waiting" });
    await seedRound(gameId, []);
    await seedParticipant(gameId, 0, "p0");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
  });

  it("rejects a round that isn't in_progress", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, [0, 1, 3], { status: "card_exchange" });
    await seedParticipant(gameId, 0, "p0");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
  });

  it("rejects a caller who isn't a seated player", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, null, "spectator");

    const response = await callEndHand(gameId, { playerId: "spectator" });
    expect(response.status).toBe(403);
  });

  it("rejects ending a hand that hasn't actually concluded", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, [0]); // only one finisher — not enough to conclude
    await seedParticipant(gameId, 0, "p0");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(400);
  });

  it("resolves a single-team-lead (1-4) finish: promotes one level and sends 4th's best card to 1st", async () => {
    const gameId = await seedGame(); // team_a_level: 2, team_b_level: 2
    // 0 finished 1st, 1 finished 2nd, 3 finished 3rd; 2 is auto-placed 4th
    // (still holding cards) — position 0's partner (2) placing 4th makes
    // this a 1-4 finish for team A.
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "7", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    expect(round?.finishing_positions).toEqual([1, 2, 4, 3]);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(3);
    expect(game?.team_b_level).toBe(2);
    expect(game?.status).toBe("in_progress");

    // 4th's (position 2) best card (KING) went to 1st (position 0).
    expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "7", suit: "HEARTS" }]);

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      game_id: gameId,
      round_id: roundId,
      action_type: "card_exchange",
      action_data: {
        from: 2,
        to: 0,
        card: { rank: "KING", suit: "CLUBS" },
        type: "initial",
      },
    });

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({ id: roundId, status: "card_exchange" }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_updated",
      expect.objectContaining({ id: gameId, team_a_level: 3 }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "card_exchange" }),
    );
  });

  it("resolves a single-team-lead (1-3) finish and promotes two levels", async () => {
    const gameId = await seedGame();
    // 0 finished 1st, 2 (0's partner) finished 3rd, 1 finished 2nd — 2
    // placing 3rd (not 4th) makes this a 1-3 finish for team A.
    await seedRound(gameId, [0, 1, 2]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", []);
    await seedParticipant(gameId, 3, "p3", [{ rank: "9", suit: "SPADES" }]);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(4); // +2 for a 1-3 finish

    // 4th (position 3) gives their best card to 1st (position 0) regardless
    // of whether the finish was 1-3 or 1-4.
    expect(handOf(gameId, 0)).toEqual([{ rank: "9", suit: "SPADES" }]);
    expect(handOf(gameId, 3)).toEqual([]);
  });

  it("resolves a two-team-lead (1-2) finish: promotes four levels and sends the higher card to 1st, lower to 2nd", async () => {
    const gameId = await seedGame();
    // 0 and 2 (partners) finish 1st and 2nd — the round ends immediately;
    // 1 and 3 are assigned 3rd/4th in position order without having
    // actually finished.
    const roundId = await seedRound(gameId, [0, 2]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", [
      { rank: "9", suit: "CLUBS" },
      { rank: "3", suit: "DIAMONDS" },
    ]);
    await seedParticipant(gameId, 2, "p2", []);
    await seedParticipant(gameId, 3, "p3", [
      { rank: "QUEEN", suit: "SPADES" },
      { rank: "4", suit: "DIAMONDS" },
    ]);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.finishing_positions).toEqual([1, 3, 2, 4]);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(6); // +4 for a 1-2 finish

    // Position 3's QUEEN outranks position 1's 9, so it goes to 1st
    // (position 0); the 9 goes to 2nd (position 2).
    expect(handOf(gameId, 0)).toEqual([{ rank: "QUEEN", suit: "SPADES" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "9", suit: "CLUBS" }]);
    expect(handOf(gameId, 1)).toEqual([{ rank: "3", suit: "DIAMONDS" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "4", suit: "DIAMONDS" }]);

    expect(fake._tables.game_actions).toHaveLength(2);
    expect(fake._tables.game_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_data: { from: 3, to: 0, card: { rank: "QUEEN", suit: "SPADES" }, type: "initial" },
        }),
        expect.objectContaining({
          action_data: { from: 1, to: 2, card: { rank: "9", suit: "CLUBS" }, type: "initial" },
        }),
      ]),
    );
  });

  it("cancels a single-team-lead tribute when 4th place alone holds both Red Jokers, and deals the next round immediately", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [
      { rank: "RED_JOKER" },
      { rank: "RED_JOKER" },
      { rank: "7", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const oldRound = fake._tables.game_rounds.find((r) => r.id === roundId);
    // Skips 'card_exchange' entirely — there's nothing to return either.
    expect(oldRound?.status).toBe("completed");
    expect(oldRound?.finishing_positions).toEqual([1, 2, 4, 3]);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(3); // level promotion still applies
    expect(game?.status).toBe("in_progress");

    // No cards changed hands.
    expect(fake._tables.game_actions ?? []).toHaveLength(0);

    // The next round was dealt immediately, in this same request.
    const newRound = fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
    expect(newRound).toBeDefined();
    expect(newRound?.leader_position).toBe(0);
    const dealtHands = fake._tables.game_participants
      .filter((p) => p.game_id === gameId)
      .map((p) => p.hand as unknown[]);
    for (const hand of dealtHands) expect(hand).toHaveLength(27);
    expect(dealtHands.flat()).toHaveLength(108);
  });

  it("cancels a two-team-lead tribute when 3rd and 4th hold both Red Jokers between them, and deals the next round immediately", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 2]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", [{ rank: "RED_JOKER" }, { rank: "5", suit: "DIAMONDS" }]);
    await seedParticipant(gameId, 2, "p2", []);
    await seedParticipant(gameId, 3, "p3", [{ rank: "RED_JOKER" }, { rank: "6", suit: "CLUBS" }]);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const oldRound = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(oldRound?.status).toBe("completed");

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(6); // +4 for a 1-2 finish, still applies

    expect(fake._tables.game_actions ?? []).toHaveLength(0);

    const newRound = fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
    expect(newRound).toBeDefined();
    expect(newRound?.leader_position).toBe(0);
  });

  it("does not cancel the tribute when only one Red Joker is held", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "RED_JOKER" }, { rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    // The tribute proceeds normally: round moves to 'card_exchange' rather
    // than skipping straight to 'completed'.
    expect(round?.status).toBe("card_exchange");
    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      action_data: { from: 2, to: 0, card: { rank: "RED_JOKER" }, type: "initial" },
    });
  });

  it("ends the game when a 1-2 finish promotes the winning team to level A", async () => {
    const gameId = await seedGame({ team_a_level: 13, team_b_level: 2 });
    const roundId = await seedRound(gameId, [0, 2]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", [{ rank: "9", suit: "CLUBS" }]);
    await seedParticipant(gameId, 2, "p2", []);
    await seedParticipant(gameId, 3, "p3", [{ rank: "QUEEN", suit: "SPADES" }]);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("completed");
    expect(round?.finishing_positions).toEqual([1, 3, 2, 4]);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.status).toBe("completed");
    expect(game?.winning_team).toBe(0);
    expect(game?.team_a_level).toBe(14);
    expect(game?.team_b_level).toBe(2);

    // No card exchange happens once the game is already won.
    expect(handOf(gameId, 1)).toEqual([{ rank: "9", suit: "CLUBS" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "QUEEN", suit: "SPADES" }]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_updated",
      expect.objectContaining({ status: "completed", winning_team: 0 }),
    );
  });

  it("does not end the game when a 1-4 finish merely reaches level A without a 1-2/1-3", async () => {
    const gameId = await seedGame({ team_a_level: 13, team_b_level: 2 });
    await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "KING", suit: "CLUBS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);

    const game = fake._tables.games.find((g) => g.id === gameId);
    // RULES.md "Winning Condition": reaching level A via a 1-4 finish just
    // means they "remain at level A and play another hand" — capped, not won.
    expect(game?.team_a_level).toBe(14);
    expect(game?.status).toBe("in_progress");

    const round = fake._tables.game_rounds.find((r) => r.game_id === gameId);
    expect(round?.status).toBe("card_exchange");
  });

  it("lets only one of two concurrent end-hand calls succeed", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "KING", suit: "CLUBS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const [r1, r2] = await Promise.all([
      callEndHand(gameId, { playerId: "p0" }),
      callEndHand(gameId, { playerId: "p1" }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    expect(fake._tables.game_actions).toHaveLength(1);
  });

  it("rolls back the round, levels, and hands if a downstream write fails after claiming the transition", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "7", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 3, "p3", []);
    fake._failNext("game_actions", "insert");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.finishing_positions).toBeNull();

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(2);

    expect(handOf(gameId, 0)).toEqual([]);
    expect(handOf(gameId, 2)).toEqual([
      { rank: "KING", suit: "CLUBS" },
      { rank: "7", suit: "HEARTS" },
    ]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
    expect(mockBroadcastToGame).not.toHaveBeenCalled();

    // A retry after the rollback resolves cleanly.
    const retry = await callEndHand(gameId, { playerId: "p0" });
    expect(retry.status).toBe(200);
  });

  it("rolls back the round claim if the game-won update fails", async () => {
    const gameId = await seedGame({ team_a_level: 13, team_b_level: 2 });
    const roundId = await seedRound(gameId, [0, 2]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", [{ rank: "9", suit: "CLUBS" }]);
    await seedParticipant(gameId, 2, "p2", []);
    await seedParticipant(gameId, 3, "p3", [{ rank: "QUEEN", suit: "SPADES" }]);
    fake._failNext("games", "update");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.finishing_positions).toBeNull();

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.status).toBe("in_progress");
    expect(game?.winning_team).toBeNull();
  });

  it("rolls back the round and level promotion if dealing the next round fails after a cancelled tribute", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "RED_JOKER" }, { rank: "RED_JOKER" }]);
    await seedParticipant(gameId, 3, "p3", []);
    // The cancelled-tribute path's round claim and games update don't touch
    // game_participants at all, so this only ever fails inside
    // dealNextRound's own deal step.
    fake._failNext("game_participants", "update");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.finishing_positions).toBeNull();

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(2);

    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(1);

    // A retry after the rollback resolves cleanly.
    const retry = await callEndHand(gameId, { playerId: "p0" });
    expect(retry.status).toBe(200);
    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(2);
  });
});
