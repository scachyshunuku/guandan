/**
 * @jest-environment node
 */
// route.ts imports NextResponse from next/server, which needs the Fetch
// API's Request/Response globals - jsdom (this repo's default test
// environment) doesn't provide them.
//
// RULES.md "Card Exchange": the round under test here is already dealt and
// already carries its `leader_position` by the time it reaches
// 'card_exchange' — startNextRound (or choose-giver-card/choose-tribute, for
// a tie) set both when the round was created, well before this route ever
// runs (see startNextRound.test.ts for that). This route's only remaining
// job once every owed return is in is a single atomic status flip — no
// dealing, no new round — so `seedRound` below sets `leader_position`
// directly rather than this file re-deriving it from finishing positions.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import type { CardExchangeActionData, CardWithWild, ExchangeCardsResponse, GameState } from "@/lib/types";
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
  leaderPosition: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  const { data: round } = await fake
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: 2,
      game_state: gameState,
      status: "card_exchange",
      leader_position: leaderPosition,
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
  from: number,
  to: number,
  card: CardWithWild,
) {
  const actionData: CardExchangeActionData = {
    from: from as CardExchangeActionData["from"],
    to: to as CardExchangeActionData["to"],
    card,
    type: "initial",
  };
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

function newRoundCount(gameId: string) {
  return fake._tables.game_rounds.filter((r) => r.game_id === gameId).length;
}

describe("POST /api/game/[id]/exchange-cards", () => {
  it("404s for a nonexistent game", async () => {
    const response = await callExchange("does-not-exist", {
      playerId: "p0",
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(response.status).toBe(404);
  });

  it("rejects a round that isn't in the card exchange phase", async () => {
    const gameId = await seedGame();
    await seedRound(gameId, 2, { status: "in_progress" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "3", suit: "HEARTS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown playerId", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }]);

    const response = await callExchange(gameId, {
      playerId: "not-a-participant",
      cardToGive: { rank: "KING", suit: "CLUBS" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects a player who didn't receive a card in the initial exchange", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 1, "p1", [{ rank: "3", suit: "HEARTS" }]);

    const response = await callExchange(gameId, {
      playerId: "p1",
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ExchangeCardsResponse;
    expect(body).toMatchObject({ success: false, reason: expect.stringContaining("did not receive") });
  });

  it("rejects a card the player doesn't hold", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }]);

    const response = await callExchange(gameId, {
      playerId: "p0",
      cardToGive: { rank: "9", suit: "DIAMONDS" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a second return submission from the same player", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
    // Two owed returns (0 owes 2, and 2 owes 0) so the round doesn't
    // finalize after p0's first submission — isolates the duplicate-
    // submission check from finalization.
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedInitialExchange(gameId, roundId, 0, 2, { rank: "3", suit: "HEARTS" });
    await seedParticipant(gameId, 0, "p0", [{ rank: "KING", suit: "CLUBS" }, { rank: "4", suit: "SPADES" }]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);

    const first = await callExchange(gameId, {
      playerId: "p0",
      cardToGive: { rank: "4", suit: "SPADES" },
    });
    expect(first.status).toBe(200);

    const second = await callExchange(gameId, {
      playerId: "p0",
      cardToGive: { rank: "KING", suit: "CLUBS" },
    });
    expect(second.status).toBe(409);
  });

  it("single-team-lead: one return activates the already-dealt round, no new round", async () => {
    const gameId = await seedGame();
    // Position 2 (4th place) gave the tribute card that went to 1st
    // (position 0) — startNextRound already set leader_position to 2
    // (RULES.md "Leader Selection") when this round was created.
    const roundId = await seedRound(gameId, 2);
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
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.current_player_turn).toBe(2);
    expect(round?.leader_position).toBe(2);
    expect(newRoundCount(gameId)).toBe(1);

    expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([
      { rank: "7", suit: "HEARTS" },
      { rank: "3", suit: "HEARTS" },
    ]);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "card_exchange" }),
    );
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "round_updated",
      expect.objectContaining({ id: roundId, status: "in_progress" }),
    );
  });

  it("two-team-lead: the round stays open until both owed returns are submitted", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 3); // position 3 gave the higher tribute card
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
      cardToGive: { rank: "5", suit: "DIAMONDS" },
    });
    expect(firstReturn.status).toBe(200);

    let round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange"); // still waiting on position 2's return

    const secondReturn = await callExchange(gameId, {
      playerId: "p2",
      cardToGive: { rank: "6", suit: "DIAMONDS" },
    });
    expect(secondReturn.status).toBe(200);

    round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.current_player_turn).toBe(3);
    expect(newRoundCount(gameId)).toBe(1);
  });

  it("lets two near-simultaneous final returns both succeed without double-activating the round", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 3);
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
        cardToGive: { rank: "5", suit: "DIAMONDS" },
      }),
      callExchange(gameId, {
        playerId: "p2",
        cardToGive: { rank: "6", suit: "DIAMONDS" },
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(newRoundCount(gameId)).toBe(1);
  });

  it("rolls back the hand transfer if the action log write fails", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
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
      cardToGive: { rank: "3", suit: "HEARTS" },
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
    const roundId = await seedRound(gameId, 2);
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
      cardToGive: { rank: "3", suit: "HEARTS" },
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
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(retry.status).toBe(200);
  });

  it("leaves the round in 'card_exchange' (not stuck 'completed') if activating it fails", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2);
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", []);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", []);
    // The return itself (game_participants/game_actions writes) has already
    // landed by the time activation runs — its own single `game_rounds`
    // update is the only write left to fail.
    fake._failNext("game_rounds", "update");

    const response = await callExchange(gameId, {
      playerId: "p0",
      cardToGive: { rank: "3", suit: "HEARTS" },
    });
    expect(response.status).toBe(500);

    const round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    // The return itself is durably recorded regardless — only activation
    // failed, and there's nothing to roll back for it (a single atomic
    // update either lands or leaves the round exactly as it was).
    expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([
      { rank: "7", suit: "HEARTS" },
      { rank: "3", suit: "HEARTS" },
    ]);
  });

  it("retries a stuck finalization on re-submission, instead of 409ing forever once every return is already in", async () => {
    const gameId = await seedGame();
    const roundId = await seedRound(gameId, 2); // single-team-lead: only 1 return owed
    await seedInitialExchange(gameId, roundId, 2, 0, { rank: "KING", suit: "CLUBS" });
    await seedParticipant(gameId, 0, "p0", [
      { rank: "KING", suit: "CLUBS" },
      { rank: "3", suit: "HEARTS" },
    ]);
    await seedParticipant(gameId, 1, "p1", [{ rank: "5", suit: "SPADES" }]);
    await seedParticipant(gameId, 2, "p2", [{ rank: "7", suit: "HEARTS" }]);
    await seedParticipant(gameId, 3, "p3", [{ rank: "6", suit: "CLUBS" }]);
    fake._failNext("game_rounds", "update");

    const body = {
      playerId: "p0",
      cardToGive: { rank: "3", suit: "HEARTS" },
    };

    const first = await callExchange(gameId, body);
    expect(first.status).toBe(500);

    let round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("card_exchange");
    // The return itself is recorded exactly once — this isn't a case where
    // the return failed, only the activation step that followed it.
    expect(
      fake._tables.game_actions.filter(
        (a) => a.action_type === "card_exchange" && (a.action_data as CardExchangeActionData).type === "return",
      ),
    ).toHaveLength(1);

    // Re-submitting the identical return would normally 409 as a duplicate
    // — but since it's the only owed return and it's already recorded, this
    // retries the stuck activation instead, with no injected failure this time.
    const retry = await callExchange(gameId, body);
    expect(retry.status).toBe(200);

    round = fake._tables.game_rounds.find((r) => r.id === roundId);
    expect(round?.status).toBe("in_progress");
    expect(round?.current_player_turn).toBe(2);
    expect(newRoundCount(gameId)).toBe(1);
  });
});
