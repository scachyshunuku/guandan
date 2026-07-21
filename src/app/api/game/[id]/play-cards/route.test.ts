/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CardWithWild, GameState, PlayCardsResponse } from "@/lib/types";
import { PASS } from "@/lib/types";
import { POST } from "./route";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
  jest.restoreAllMocks();
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
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = { currentTrick: [], trickCount: 0 };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 1,
      game_state: gameState,
      leader_position: 0,
      current_player_turn: 0,
      ...overrides,
    })
    .select("id")
    .single();
  return (round as { id: string }).id;
}

async function seedParticipant(
  gameId: string,
  position: number,
  playerId: string,
  hand: CardWithWild[],
) {
  await fake.from("game_participants").insert({
    game_id: gameId,
    player_name: playerId,
    player_id: playerId,
    position,
    hand,
  });
}

function callPlayCards(gameId: string, body: unknown) {
  const request = new Request(`http://localhost/api/game/${gameId}/play-cards`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: gameId }) });
}

describe("POST /api/game/[id]/play-cards", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callPlayCards("does-not-exist", {
      cards: [],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(404);
  });

  it("rejects a game that hasn't started", async () => {
    const gameId = await seedGame({ status: "waiting" });
    await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a playerId that doesn't match the claimed position", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 1,
    });
    expect(response.status).toBe(403);
  });

  it("rejects an out-of-range or malformed position", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    for (const position of [4, -1, "0", null, undefined]) {
      const response = await callPlayCards(gameId, {
        cards: [{ rank: "7", suit: "CLUBS" }],
        playerId: "p0",
        position,
      });
      expect(response.status).toBe(400);
    }
  });

  it("rejects a spectator (position: null) even when the round is frozen with current_player_turn: null", async () => {
    // Regression: a naive `caller.position !== position` check treats a
    // spectator's `position: null` and a submitted `position: null` as a
    // match. Reproduce the exact state where that would matter — a round
    // halted after a hand-ending play (current_player_turn: null, see the
    // "halts turn advancement" tests below) — and confirm a spectator still
    // can't act on it.
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: null });
    await seedParticipant(gameId, null as unknown as number, "spectator", []);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "spectator",
      position: null,
    });
    expect(response.status).toBe(400);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
  });

  it("rejects a play when it isn't the caller's turn", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, { current_player_turn: 1 });
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as PlayCardsResponse;
    expect(body).toMatchObject({ success: false, reason: "not your turn" });
  });

  it("rejects a card the player doesn't hold", async () => {
    const gameId = await seedGame();
    await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "8", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as PlayCardsResponse;
    expect(body.success).toBe(false);
  });

  it("rejects a response that doesn't beat the lead", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, {
      game_state: { currentTrick: [[{ rank: "9", suit: "CLUBS" }]], trickCount: 0 },
      current_player_turn: 1,
    });
    await seedParticipant(gameId, 0, "p0", []);
    await seedParticipant(gameId, 1, "p1", [{ rank: "7", suit: "HEARTS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "HEARTS" }],
      playerId: "p1",
      position: 1,
    });
    expect(response.status).toBe(400);
  });

  it("accepts a valid lead, removes the cards from hand, and advances turn", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toEqual([{ rank: "8", suit: "HEARTS" }]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBe(1);
    expect(round?.leader_position).toBe(0);
    expect((round?.game_state as GameState).currentTrick).toEqual([
      [{ rank: "7", suit: "CLUBS" }],
    ]);

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      game_id: gameId,
      round_id: roundId,
      player_id: "p0",
      action_type: "card_played",
      action_data: { cards: [{ rank: "7", suit: "CLUBS" }], position: 0 },
    });
  });

  it("resolves the trick once all 4 positions have acted, crediting the last non-PASS play", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 3,
      game_state: {
        currentTrick: [
          [{ rank: "7", suit: "CLUBS" }],
          PASS,
          [{ rank: "9", suit: "CLUBS" }],
        ],
        trickCount: 2,
      },
    });
    await seedParticipant(gameId, 3, "p3", [
      { rank: "10", suit: "CLUBS" },
      { rank: "2", suit: "DIAMONDS" },
    ]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "10", suit: "CLUBS" }],
      playerId: "p3",
      position: 3,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    // position 3's play was the last non-PASS entry, so they win and lead next.
    expect(round?.leader_position).toBe(3);
    expect(round?.current_player_turn).toBe(3);
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 3 });
  });

  it("halts turn advancement (even the trick's own winner) when the play empties the player's hand", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 3,
      game_state: {
        currentTrick: [
          [{ rank: "7", suit: "CLUBS" }],
          PASS,
          [{ rank: "9", suit: "CLUBS" }],
        ],
        trickCount: 2,
      },
    });
    await seedParticipant(gameId, 3, "p3", [{ rank: "10", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "10", suit: "CLUBS" }],
      playerId: "p3",
      position: 3,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    // p3 won the trick (so leads next per RULES.md) but has no cards left to
    // lead with — turn stays null until Task 3.3's end-hand endpoint resolves it.
    expect(round?.leader_position).toBe(3);
    expect(round?.current_player_turn).toBeNull();
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 3 });
  });

  it("halts turn advancement when the play empties the player's hand", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBeNull();

    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toEqual([]);
  });

  it("lets only one of two concurrent plays for the same turn succeed", async () => {
    // Both requests read the round while current_player_turn is still 0, so
    // both independently compute a valid play — the compare-and-swap on the
    // game_rounds write (not the initial read) is what has to reject the
    // loser, same concurrency shape as start/route.test.ts's start-game race.
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);

    const [r1, r2] = await Promise.all([
      callPlayCards(gameId, {
        cards: [{ rank: "7", suit: "CLUBS" }],
        playerId: "p0",
        position: 0,
      }),
      callPlayCards(gameId, {
        cards: [{ rank: "8", suit: "HEARTS" }],
        playerId: "p0",
        position: 0,
      }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect((round?.game_state as GameState).currentTrick).toHaveLength(1);
    expect(round?.current_player_turn).toBe(1);

    // Only the winner's card actually left the hand.
    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toHaveLength(1);

    expect(fake._tables.game_actions).toHaveLength(1);
  });

  it("rolls back the round and hand if the action log write fails after claiming the turn", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);
    fake._failNext("game_actions", "insert");

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBe(0);
    expect(round?.leader_position).toBe(0);
    expect((round?.game_state as GameState).currentTrick).toEqual([]);

    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toEqual([
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);

    // A retry after the rollback plays cleanly.
    const retry = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(retry.status).toBe(200);
  });

  it("does not stomp a legitimate next player's committed turn when a failed write's rollback races behind it", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId);
    await seedParticipant(gameId, 0, "p0", [
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);

    // Simulate another request (player 1, legitimately holding the turn our
    // claim just handed them) completing their own play in the window
    // between our claim landing and our action-log write failing — by
    // mutating the round directly the instant our action-log insert is
    // constructed, i.e. before this request's rollback ever runs.
    const originalFrom = fake.from.bind(fake);
    jest.spyOn(fake, "from").mockImplementation((table: string) => {
      const builder = originalFrom(table);
      if (table === "game_actions") {
        const originalInsert = builder.insert.bind(builder);
        builder.insert = ((payload: unknown) => {
          const round = fake._tables.game_rounds.find((r) => r.id === roundId)!;
          round.current_player_turn = 2;
          round.leader_position = 0;
          round.game_state = {
            currentTrick: [[{ rank: "7", suit: "CLUBS" }], [{ rank: "9", suit: "CLUBS" }]],
            trickCount: 0,
          };
          return originalInsert(payload);
        }) as typeof builder.insert;
      }
      return builder;
    });
    fake._failNext("game_actions", "insert");

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    // Rollback must not have clobbered player 1's already-committed advance.
    expect(round?.current_player_turn).toBe(2);
    expect((round?.game_state as GameState).currentTrick).toHaveLength(2);

    // The hand revert is unaffected — it's scoped to the caller's own row,
    // independent of the round's later progression.
    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toEqual([
      { rank: "7", suit: "CLUBS" },
      { rank: "8", suit: "HEARTS" },
    ]);
  });
});
