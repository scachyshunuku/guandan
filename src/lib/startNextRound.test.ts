/**
 * @jest-environment node
 */
// startNextRound.ts imports supabaseAdmin (a real @supabase/supabase-js
// client under the hood), which needs the Fetch API's Request/Response
// globals - jsdom (this repo's default test environment) doesn't provide
// them, same as every API route test.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";
import type { Card, PlayerPosition } from "@/lib/types";
import type { ParticipantRow } from "./gameDb";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");
jest.mock("@/lib/deck");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import { dealHands } from "@/lib/deck";
import { startNextRound } from "./startNextRound";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;
const mockBroadcastToGame = broadcastToGame as jest.MockedFunction<typeof broadcastToGame>;
const mockDealHands = dealHands as jest.MockedFunction<typeof dealHands>;

beforeEach(() => {
  fake._reset();
  mockBroadcastToGame.mockClear();
  mockDealHands.mockReset();
});

async function seedParticipant(
  gameId: string,
  position: PlayerPosition,
  playerId: string,
  leftoverHand: Card[] = [],
): Promise<ParticipantRow> {
  const { data } = await fake
    .from("game_participants")
    .insert({
      game_id: gameId,
      player_name: playerId,
      player_id: playerId,
      position,
      hand: leftoverHand,
    })
    .select("*")
    .single();
  const row = data as { id: string; player_id: string; player_name: string; position: number; hand: Card[] };
  return { id: row.id, player_id: row.player_id, player_name: row.player_name, position, hand: row.hand };
}

// Returns the seeded rows in the shape startNextRound's `participants`
// parameter expects — matching end-hand/route.ts's own getGameContext()
// read, which is what a real caller passes through (startNextRound no
// longer re-fetches these itself).
function seedFourSeats(
  gameId: string,
  leftoverHands: [Card[], Card[], Card[], Card[]] = [[], [], [], []],
): Promise<ParticipantRow[]> {
  return Promise.all(
    ([0, 1, 2, 3] as const).map((position) => seedParticipant(gameId, position, `p${position}`, leftoverHands[position])),
  );
}

function handOf(gameId: string, position: number) {
  return fake._tables.game_participants.find(
    (p) => p.game_id === gameId && p.position === position,
  )?.hand as Card[] | undefined;
}

function newRoundOf(gameId: string) {
  return fake._tables.game_rounds.find((r) => r.game_id === gameId && r.round_number === 2);
}

describe("startNextRound", () => {
  it("deals the new hand and activates immediately when the tribute is cancelled (single-team lead)", async () => {
    const gameId = "game-1";
    const participants = await seedFourSeats(gameId);
    mockDealHands.mockReturnValue([
      [{ rank: "3", suit: "CLUBS" }],
      [],
      [{ rank: "RED_JOKER" }, { rank: "RED_JOKER" }],
      [],
    ]);

    const outcome = await startNextRound(gameId, 1, [1, 2, 4, 3], "1-4", "p0", "2", participants);
    expect(outcome).toBe("started");

    const round = newRoundOf(gameId);
    expect(round).toMatchObject({
      round_number: 2,
      status: "in_progress",
      leader_position: 0,
      current_player_turn: 0,
    });
    expect(round?.game_state).toEqual({ currentTrick: [], trickCount: 0, finishOrder: [] });

    // No transfer — the dealt hands land as-is.
    expect(handOf(gameId, 2)).toEqual([{ rank: "RED_JOKER" }, { rank: "RED_JOKER" }]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);

    expect(mockBroadcastToGame).toHaveBeenCalledWith(gameId, "round_updated", expect.objectContaining({ id: round?.id }));
  });

  it("pauses on 'awaiting_giver_choice' when the new hand ties a single giver's best card, without transferring anything", async () => {
    const gameId = "game-1";
    const participants = await seedFourSeats(gameId);
    mockDealHands.mockReturnValue([
      [{ rank: "3", suit: "CLUBS" }],
      [],
      [{ rank: "KING", suit: "SPADES" }, { rank: "KING", suit: "HEARTS" }],
      [],
    ]);

    const outcome = await startNextRound(gameId, 1, [1, 2, 4, 3], "1-4", "p0", "2", participants);
    expect(outcome).toBe("started");

    const round = newRoundOf(gameId);
    expect(round).toMatchObject({ status: "awaiting_giver_choice", leader_position: null, current_player_turn: null });
    expect(round?.game_state).toMatchObject({
      pendingGiverChoice: { levelRank: "2", pendingPositions: [2], resolvedCards: {} },
    });
    // Carried over from the just-finished hand — choose-giver-card/route.ts
    // (and the client's isFirstPlace check) need this to know 1st/2nd/3rd/
    // 4th while *this* round's own finishing_positions doesn't exist yet.
    expect(round?.finishing_positions).toEqual([1, 2, 4, 3]);

    expect(handOf(gameId, 2)).toEqual([{ rank: "KING", suit: "SPADES" }, { rank: "KING", suit: "HEARTS" }]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
  });

  it("pauses on 'awaiting_tribute_choice' when the new hand ties 3rd's and 4th's best cards against each other", async () => {
    const gameId = "game-1";
    const participants = await seedFourSeats(gameId);
    mockDealHands.mockReturnValue([
      [],
      [{ rank: "9", suit: "CLUBS" }],
      [],
      [{ rank: "9", suit: "SPADES" }],
    ]);

    const outcome = await startNextRound(gameId, 1, [1, 3, 2, 4], "1-2", "p0", "2", participants);
    expect(outcome).toBe("started");

    const round = newRoundOf(gameId);
    expect(round).toMatchObject({ status: "awaiting_tribute_choice", leader_position: null, current_player_turn: null });
    expect(round?.game_state).toMatchObject({
      pendingTributeChoice: {
        thirdPosition: 1,
        thirdCard: { rank: "9", suit: "CLUBS" },
        fourthPosition: 3,
        fourthCard: { rank: "9", suit: "SPADES" },
      },
    });
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
  });

  it("applies the initial transfer and sets leader_position on the new (not-yet-playable) round for a single-team lead", async () => {
    const gameId = "game-1";
    const participants = await seedFourSeats(gameId);
    mockDealHands.mockReturnValue([
      [],
      [],
      [{ rank: "KING", suit: "CLUBS" }, { rank: "7", suit: "HEARTS" }],
      [],
    ]);

    const outcome = await startNextRound(gameId, 1, [1, 2, 4, 3], "1-4", "p0", "2", participants);
    expect(outcome).toBe("started");

    const round = newRoundOf(gameId);
    // Leader is set immediately (whoever gave up 1st place's tribute card),
    // but the round isn't playable yet — current_player_turn stays null
    // until exchange-cards/route.ts activates it once the return is in.
    expect(round).toMatchObject({ status: "card_exchange", leader_position: 2, current_player_turn: null });

    expect(handOf(gameId, 0)).toEqual([{ rank: "KING", suit: "CLUBS" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "7", suit: "HEARTS" }]);

    expect(fake._tables.game_actions).toHaveLength(1);
    expect(fake._tables.game_actions[0]).toMatchObject({
      round_id: round?.id,
      action_type: "card_exchange",
      action_data: { from: 2, to: 0, card: { rank: "KING", suit: "CLUBS" }, type: "initial" },
    });
    expect(mockBroadcastToGame).toHaveBeenCalledWith(
      gameId,
      "game_action",
      expect.objectContaining({ action_type: "card_exchange" }),
    );
  });

  it("applies both transfers and sets leader_position to whoever gave the higher card, for a two-team lead", async () => {
    const gameId = "game-1";
    const participants = await seedFourSeats(gameId);
    mockDealHands.mockReturnValue([
      [],
      [{ rank: "9", suit: "CLUBS" }, { rank: "3", suit: "DIAMONDS" }],
      [],
      [{ rank: "QUEEN", suit: "SPADES" }, { rank: "4", suit: "DIAMONDS" }],
    ]);

    const outcome = await startNextRound(gameId, 1, [1, 3, 2, 4], "1-2", "p0", "2", participants);
    expect(outcome).toBe("started");

    const round = newRoundOf(gameId);
    // Position 3's QUEEN outranks position 1's 9, so it's the card routed
    // to 1st place — position 3 leads next.
    expect(round).toMatchObject({ status: "card_exchange", leader_position: 3 });

    expect(handOf(gameId, 0)).toEqual([{ rank: "QUEEN", suit: "SPADES" }]);
    expect(handOf(gameId, 2)).toEqual([{ rank: "9", suit: "CLUBS" }]);
    expect(handOf(gameId, 1)).toEqual([{ rank: "3", suit: "DIAMONDS" }]);
    expect(handOf(gameId, 3)).toEqual([{ rank: "4", suit: "DIAMONDS" }]);
    expect(fake._tables.game_actions).toHaveLength(2);
  });

  it("rolls back the new round and every dealt hand if a hand write fails", async () => {
    const gameId = "game-1";
    const leftoverHands: [Card[], Card[], Card[], Card[]] = [
      [{ rank: "2", suit: "CLUBS" }],
      [],
      [],
      [],
    ];
    const participants = await seedFourSeats(gameId, leftoverHands);
    mockDealHands.mockReturnValue([
      [{ rank: "3", suit: "CLUBS" }],
      [],
      [{ rank: "RED_JOKER" }, { rank: "RED_JOKER" }],
      [],
    ]);
    fake._failNext("game_participants", "update");

    const outcome = await startNextRound(gameId, 1, [1, 2, 4, 3], "1-4", "p0", "2", participants);
    expect(outcome).toBe("error");

    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(0);
    expect(handOf(gameId, 0)).toEqual(leftoverHands[0]);
    expect(mockBroadcastToGame).not.toHaveBeenCalled();
  });

  it("rolls back the new round, dealt hands, and any logged transfer if the action insert fails", async () => {
    const gameId = "game-1";
    const leftoverHands: [Card[], Card[], Card[], Card[]] = [[], [], [{ rank: "9", suit: "HEARTS" }], []];
    const participants = await seedFourSeats(gameId, leftoverHands);
    mockDealHands.mockReturnValue([
      [],
      [],
      [{ rank: "KING", suit: "CLUBS" }, { rank: "7", suit: "HEARTS" }],
      [],
    ]);
    fake._failNext("game_actions", "insert");

    const outcome = await startNextRound(gameId, 1, [1, 2, 4, 3], "1-4", "p0", "2", participants);
    expect(outcome).toBe("error");

    expect(fake._tables.game_rounds.filter((r) => r.game_id === gameId)).toHaveLength(0);
    expect(handOf(gameId, 2)).toEqual(leftoverHands[2]);
    expect(fake._tables.game_actions ?? []).toHaveLength(0);
    expect(mockBroadcastToGame).not.toHaveBeenCalled();
  });
});
