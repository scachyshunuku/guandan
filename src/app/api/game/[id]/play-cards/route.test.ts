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
import type { CardWithWild, GameState, PlayCardsResponse } from "@/lib/types";
import { PASS } from "@/lib/types";
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
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
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
    // halted after the round concluded (see the round-end tests below) —
    // and confirm a spectator still can't act on it.
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
      game_state: {
        currentTrick: [{ position: 0, play: [{ rank: "9", suit: "CLUBS" }] }],
        trickCount: 0,
        finishOrder: [],
      },
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
      { position: 0, play: [{ rank: "7", suit: "CLUBS" }] },
    ]);

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      game_id: gameId,
      round_id: roundId,
      player_id: "p0",
      action_type: "card_played",
      action_data: { cards: [{ rank: "7", suit: "CLUBS" }], position: 0 },
    });

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({ id: roundId, current_player_turn: 1 }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "card_played", player_id: "p0" }),
    );
  });

  it("resolves the trick once all 4 positions have acted, crediting the last non-PASS play", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 3,
      game_state: {
        currentTrick: [
          { position: 0, play: [{ rank: "7", suit: "CLUBS" }] },
          { position: 1, play: PASS },
          { position: 2, play: [{ rank: "9", suit: "CLUBS" }] },
        ],
        trickCount: 2,
        finishOrder: [],
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
    // position 3's play was the last non-PASS entry, so they win and lead
    // next — they still have a card left, so they lead themselves.
    expect(round?.leader_position).toBe(3);
    expect(round?.current_player_turn).toBe(3);
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 3, finishOrder: [] });
  });

  it("hands the lead to the winner's partner when the winning play empties their hand", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 3,
      game_state: {
        currentTrick: [
          { position: 0, play: [{ rank: "7", suit: "CLUBS" }] },
          { position: 1, play: PASS },
          { position: 2, play: [{ rank: "9", suit: "CLUBS" }] },
        ],
        trickCount: 2,
        finishOrder: [],
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
    // p3 (team B, positions 1 & 3) won the trick but has no cards left to
    // lead with, so their partner (position 1) leads next instead — the
    // round continues rather than freezing, since only one player is out
    // (RULES.md "Winner out of cards").
    expect(round?.leader_position).toBe(1);
    expect(round?.current_player_turn).toBe(1);
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 3, finishOrder: [3] });
  });

  it("continues play with the next active player when a lead empties the leader's hand (round not yet decided)", async () => {
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
    // Only one player is out — the round doesn't end (detectRoundEnd needs
    // 3 finishers, or a 1-2 shortcut), so play continues normally to the
    // next position.
    expect(round?.current_player_turn).toBe(1);
    expect(round?.leader_position).toBe(0);
    expect((round?.game_state as GameState).finishOrder).toEqual([0]);

    const participant = fake._tables.game_participants.find((p) => p.game_id === gameId);
    expect(participant?.hand).toEqual([]);
  });

  it("skips a position that finished in an earlier trick when computing the next turn", async () => {
    const gameId = await seedGame();
    // Position 1 already went out in an earlier trick; a fresh trick is
    // underway led by position 0.
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 0,
      game_state: { currentTrick: [], trickCount: 1, finishOrder: [1] },
    });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "7", suit: "CLUBS" },
      { rank: "2", suit: "DIAMONDS" },
    ]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p0",
      position: 0,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    // Turn skips position 1 (already out) and goes straight to position 2.
    expect(round?.current_player_turn).toBe(2);
  });

  it("freezes the round once a 3rd player finishes (round concluded)", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, {
      leader_position: 0,
      current_player_turn: 2,
      // Positions 1 and 3 already finished; position 2 is about to become
      // the 3rd, which concludes the round (the 4th is placed last
      // automatically — RULES.md "Round End").
      game_state: { currentTrick: [], trickCount: 5, finishOrder: [1, 3] },
    });
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p2",
      position: 2,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBeNull();
    expect((round?.game_state as GameState).finishOrder).toEqual([1, 3, 2]);
  });

  it("freezes the round immediately on a 1-2 finish, before a 3rd finisher", async () => {
    const gameId = await seedGame();
    // Position 0 already finished 1st. Position 2 (0's partner) finishing
    // 2nd concludes the round right away, without waiting for a 3rd
    // finisher (RULES.md "Round End").
    const roundId = await seedRound(gameId, {
      leader_position: 2,
      current_player_turn: 2,
      game_state: { currentTrick: [], trickCount: 5, finishOrder: [0] },
    });
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "CLUBS" }]);

    const response = await callPlayCards(gameId, {
      cards: [{ rank: "7", suit: "CLUBS" }],
      playerId: "p2",
      position: 2,
    });
    expect(response.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.current_player_turn).toBeNull();
    expect((round?.game_state as GameState).finishOrder).toEqual([0, 2]);
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

    expect(mockBroadcastToGame).not.toHaveBeenCalled();

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
            currentTrick: [
              { position: 0, play: [{ rank: "7", suit: "CLUBS" }] },
              { position: 1, play: [{ rank: "9", suit: "CLUBS" }] },
            ],
            trickCount: 0,
            finishOrder: [],
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
