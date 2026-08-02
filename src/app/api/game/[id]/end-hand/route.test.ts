/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
//
// RULES.md "Card Exchange": the next round's cards are now dealt (and the
// tribute planned) inside startNextRound (lib/startNextRound.ts), against a
// freshly-shuffled hand — startNextRound.test.ts exhaustively covers every
// branch of that (cancelled/tied/resolved) with a mocked deal for
// determinism. This file's job is narrower: claiming the just-finished
// round, applying level promotion, the game-won short-circuit, and rolling
// back its own writes if startNextRound fails — so most of what's below
// deliberately doesn't pin down which branch the (real, random) deal lands
// on, only that end-hand correctly delegates to it and persists the result.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { CardWithWild, GameState, PlayerPosition, RoundStatus } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<typeof broadcastToGame>;

const VALID_NEW_ROUND_STATUSES: RoundStatus[] = [
  "in_progress",
  "awaiting_giver_choice",
  "awaiting_tribute_choice",
  "card_exchange",
];

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

function newRoundOf(gameId: string) {
  return fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
}

// RULES.md "Card Exchange": whatever branch the freshly-dealt hand's tribute
// plan lands on, the total number of cards across all 4 hands is conserved
// (dealt 27 each, then at most a couple of cards move between hands) —
// 108 either way, regardless of which of the 4 valid statuses the new round
// starts in.
function expectNewRoundWasDealt(gameId: string) {
  const round = newRoundOf(gameId);
  expect(round).toBeDefined();
  expect(VALID_NEW_ROUND_STATUSES).toContain(round?.status);
  const dealtHands = fake._tables.game_participants
    .filter((p) => p.game_id === gameId)
    .map((p) => p.hand as unknown[]);
  expect(dealtHands.flat()).toHaveLength(108);
  return round;
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

  it("resolves a single-team-lead (1-4) finish: completes the old round, promotes one level, and starts the next round", async () => {
    const gameId = await seedGame(); // team_a_level: 2, team_b_level: 2
    // 0 finished 1st, 1 finished 2nd, 3 finished 3rd; 2 is auto-placed 4th
    // (still holding cards) — position 0's partner (2) placing 4th makes
    // this a 1-4 finish for team A.
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "KING", suit: "CLUBS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("completed");
    expect(round?.finishing_positions).toEqual([1, 2, 4, 3]);

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(3);
    expect(game?.team_b_level).toBe(2);
    expect(game?.status).toBe("in_progress");

    const newRound = expectNewRoundWasDealt(gameId);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({ id: newRound?.id, round_number: 2 }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_updated",
      expect.objectContaining({ id: gameId, team_a_level: 3 }),
    );

    // The just-finished round's own placements are logged against *its* id
    // (not the new round's), same as trick_end/player_finished describe the
    // round they occurred in - RULES.md "Round End".
    expect(fake._tables.game_actions).toContainEqual(
      expect.objectContaining({
        round_id: roundId,
        action_type: "round_ended",
        action_data: { finishingPositions: [1, 2, 4, 3] },
      }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ round_id: roundId, action_type: "round_ended" }),
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

    expectNewRoundWasDealt(gameId);
  });

  it("resolves a two-team-lead (1-2) finish: promotes four levels and starts the next round", async () => {
    const gameId = await seedGame();
    // 0 and 2 (partners) finish 1st and 2nd — the round ends immediately;
    // 1 and 3 are assigned 3rd/4th in position order without having
    // actually finished.
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
    expect(game?.team_a_level).toBe(6); // +4 for a 1-2 finish

    expectNewRoundWasDealt(gameId);
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

    // No card exchange happens (and no next round is dealt) once the game
    // is already won.
    expect(handOf(gameId, 1)).toEqual([{ rank: "9", suit: "CLUBS" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "QUEEN", suit: "SPADES" }]);
    expect(newRoundOf(gameId)).toBeUndefined();

    // The only game_action logged for the won game itself is the round's
    // own final placements (RULES.md "Round End") - no card exchange, since
    // there's no next round to plan one against.
    expect(fake._tables.game_actions ?? []).toEqual([
      expect.objectContaining({
        round_id: roundId,
        action_type: "round_ended",
        action_data: { finishingPositions: [1, 3, 2, 4] },
      }),
    ]);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_updated",
      expect.objectContaining({ status: "completed", winning_team: 0 }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "round_ended" }),
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

    expectNewRoundWasDealt(gameId);
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
    expect(round?.status).toBe("completed");
    expectNewRoundWasDealt(gameId);
  });

  it("rolls back the round claim and level promotion if starting the next round fails", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, [0, 1, 3]);
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "KING", suit: "CLUBS" }]);
    await seedParticipant(gameId, 3, "p3", []);
    // Reached inside startNextRound's own deal step regardless of which
    // tribute branch the (real, random) deal lands on — every branch writes
    // every seat's dealt hand. startNextRound's own internal rollback
    // already restores the round/hands it touched; this only needs to
    // verify end-hand's own claim and level promotion also unwind.
    fake._failNext("game_participants", "update");

    const response = await callEndHand(gameId, { playerId: "p0" });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.finishing_positions).toBeNull();

    const game = fake._tables.games.find((g) => g.id === gameId);
    expect(game?.team_a_level).toBe(2);

    expect(handOf(gameId, 0)).toEqual([]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
    expect(newRoundOf(gameId)).toBeUndefined();
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
});
