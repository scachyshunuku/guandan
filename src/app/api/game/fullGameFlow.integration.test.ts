/**
 * @jest-environment node
 */
// End-to-end game flow (IMPLEMENTATION.md Task 6.1): drives create -> 4
// joins -> start -> a full round of play across multiple tricks -> hand end
// -> card exchange -> the next round being dealt, all against the same fake
// Supabase instance (see fullGameSetup.integration.test.ts, which this
// extends, for why a fake rather than a live Supabase project — every other
// route-level integration test in this codebase uses the same fake, and a
// real project would need live credentials this suite can't depend on).
//
// Play strategy: whoever leads a trick plays a single card from their hand;
// everyone else always passes. That's always legal (RULES.md "When
// Leading"/"Passing") and deterministic regardless of the random deal: the
// leader keeps winning their own tricks and leading again (RULES.md "Leader
// Selection") until their hand empties, at which point their partner leads
// next. Since partners are positions 0&2 / 1&3, the first two players to
// empty their hands this way are always partners — a "1-2" finish — which
// exercises the two-return (3rd and 4th both owe a tribute) card-exchange
// path end to end.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bestCardCandidates } from "@/lib/gameRules/cardExchange";
import type {
  Card,
  CardExchangeActionData,
  CardWithWild,
  ChooseGiverCardResponse,
  ChooseTributeResponse,
  CreateGameResponse,
  EndHandResponse,
  ExchangeCardsResponse,
  GameState,
  GameStateResponse,
  JoinGameResponse,
  PassResponse,
  PlayCardsResponse,
  PlayerPosition,
  StartGameResponse,
} from "@/lib/types";
import { POST as playCardsRoute } from "./[id]/play-cards/route";
import { POST as passRoute } from "./[id]/pass/route";
import { POST as endHandRoute } from "./[id]/end-hand/route";
import { POST as exchangeCardsRoute } from "./[id]/exchange-cards/route";
import { POST as chooseGiverCardRoute } from "./[id]/choose-giver-card/route";
import { POST as chooseTributeRoute } from "./[id]/choose-tribute/route";
import { GET as getGameRoute } from "./[id]/route";
import { create as createGame, join, start } from "@/testUtils/gameRouteHelpers";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

function playCards(gameId: string, playerId: string, position: PlayerPosition, cards: CardWithWild[]) {
  const request = new Request(`http://localhost/api/game/${gameId}/play-cards`, {
    method: "POST",
    body: JSON.stringify({ playerId, position, cards }),
  });
  return playCardsRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function pass(gameId: string, playerId: string, position: PlayerPosition) {
  const request = new Request(`http://localhost/api/game/${gameId}/pass`, {
    method: "POST",
    body: JSON.stringify({ playerId, position }),
  });
  return passRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function endHand(gameId: string, playerId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/end-hand`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
  return endHandRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function exchangeCards(
  gameId: string,
  playerId: string,
  position: PlayerPosition,
  cardToGive: CardWithWild,
  recipientPosition: PlayerPosition,
) {
  const request = new Request(`http://localhost/api/game/${gameId}/exchange-cards`, {
    method: "POST",
    body: JSON.stringify({ playerId, position, cardToGive, type: "return", recipientPosition }),
  });
  return exchangeCardsRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function chooseGiverCard(gameId: string, playerId: string, card: Card) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-giver-card`, {
    method: "POST",
    body: JSON.stringify({ playerId, card }),
  });
  return chooseGiverCardRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function chooseTribute(gameId: string, playerId: string, take: PlayerPosition) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-tribute`, {
    method: "POST",
    body: JSON.stringify({ playerId, take }),
  });
  return chooseTributeRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function getGameState(gameId: string, playerId: string) {
  const url = new URL(`http://localhost/api/game/${gameId}`);
  url.searchParams.set("playerId", playerId);
  return getGameRoute(new NextRequest(url), { params: Promise.resolve({ id: gameId }) });
}

interface RoundRow {
  id: string;
  game_id: string;
  round_number: number;
  game_state: GameState;
  current_player_turn: PlayerPosition | null;
  leader_position: PlayerPosition | null;
  status: string;
  finishing_positions: number[] | null;
}

interface ParticipantRow {
  id: string;
  game_id: string;
  player_id: string;
  position: PlayerPosition | null;
  hand: CardWithWild[];
}

function latestRound(gameId: string): RoundRow {
  const rounds = (fake._tables.game_rounds as unknown as RoundRow[]).filter((r) => r.game_id === gameId);
  return rounds.reduce((latest, r) => (r.round_number > latest.round_number ? r : latest));
}

function roundById(roundId: string): RoundRow {
  return (fake._tables.game_rounds as unknown as RoundRow[]).find((r) => r.id === roundId)!;
}

function seatedParticipants(gameId: string): ParticipantRow[] {
  return (fake._tables.game_participants as unknown as ParticipantRow[]).filter(
    (p) => p.game_id === gameId && p.position !== null,
  );
}

function handOf(gameId: string, position: PlayerPosition): CardWithWild[] {
  return seatedParticipants(gameId).find((p) => p.position === position)!.hand;
}

describe("end-to-end game flow", () => {
  it("takes a game from creation through a full round, card exchange, and the next deal", async () => {
    // 1. Create the game.
    const { gameId } = (await (await createGame()).json()) as CreateGameResponse;

    // 2. 4 players join and are seated 0-3.
    const playerIdByPosition: Record<PlayerPosition, string> = { 0: "p0", 1: "p1", 2: "p2", 3: "p3" };
    for (let i = 0; i < 4; i++) {
      const response = await join(gameId, `Player ${i}`, `p${i}`);
      const body = (await response.json()) as JoinGameResponse;
      expect(body).toEqual({ spectator: false, position: i, hand: [] });
    }

    // 3. Start the game: cards are dealt, 27 to each seat.
    const startResponse = await start(gameId, "p0");
    expect(startResponse.status).toBe(200);
    const startBody = (await startResponse.json()) as StartGameResponse;
    expect(startBody.hand).toHaveLength(27);
    for (let position = 0 as PlayerPosition; position < 4; position++) {
      expect(handOf(gameId, position)).toHaveLength(27);
    }

    const firstRound = latestRound(gameId);
    expect(firstRound.round_number).toBe(1);
    expect(firstRound.leader_position).not.toBeNull();

    // 4. Round of play across multiple tricks: the leader plays a single
    // each trick, everyone else passes, until two partners have each
    // emptied their hand (a 1-2 finish).
    let leaderPosition = firstRound.leader_position as PlayerPosition;
    let tricksPlayed = 0;
    while (true) {
      const card = handOf(gameId, leaderPosition)[0];
      const playResponse = await playCards(gameId, playerIdByPosition[leaderPosition], leaderPosition, [card]);
      expect(playResponse.status).toBe(200);
      expect(((await playResponse.json()) as PlayCardsResponse).success).toBe(true);
      tricksPlayed++;

      let roundEnded = false;
      while (true) {
        const round = latestRound(gameId);
        if (round.current_player_turn === null) {
          roundEnded = true;
          break;
        }
        if (round.game_state.currentTrick.length === 0) {
          leaderPosition = round.leader_position as PlayerPosition;
          break;
        }
        const turnPosition = round.current_player_turn;
        const passResponse = await pass(gameId, playerIdByPosition[turnPosition], turnPosition);
        expect(passResponse.status).toBe(200);
        expect(((await passResponse.json()) as PassResponse).success).toBe(true);
      }
      if (roundEnded) break;
    }
    expect(tricksPlayed).toBeGreaterThan(1);

    const concludedRound = latestRound(gameId);
    expect(concludedRound.round_number).toBe(1);
    expect(concludedRound.status).toBe("in_progress"); // end-hand hasn't run yet
    expect(concludedRound.game_state.finishOrder).toHaveLength(2);
    const [firstFinisher, secondFinisher] = concludedRound.game_state.finishOrder;
    expect(secondFinisher).toBe(((firstFinisher + 2) % 4) as PlayerPosition); // partners

    // 5. End the hand: finishing positions are recorded on round 1 (now
    // 'completed'), and — RULES.md "Card Exchange": the next round's cards
    // are dealt immediately, before any tribute card is given or returned —
    // round 2 is created in the same request, already dealt and already
    // planned against that new hand (cancelled straight to 'in_progress',
    // paused on a tie, or waiting on 'card_exchange' returns).
    const endHandResponse = await endHand(gameId, playerIdByPosition[firstFinisher]);
    expect(endHandResponse.status).toBe(200);
    expect(((await endHandResponse.json()) as EndHandResponse).success).toBe(true);

    const handEndedRound = roundById(concludedRound.id);
    expect(handEndedRound.status).toBe("completed");
    expect(handEndedRound.finishing_positions?.[firstFinisher]).toBe(1);
    expect(handEndedRound.finishing_positions?.[secondFinisher]).toBe(2);

    let round2 = latestRound(gameId);
    expect(round2.round_number).toBe(2);

    // 6. Resolve any tie the freshly-dealt hand's tribute plan hit (RULES.md
    // "Best card, when tied" / "Two-Team Lead") — deterministic (always the
    // first tied candidate / the third-place card) since this is exercising
    // the wiring, not the choice logic itself (covered elsewhere).
    while (round2.status === "awaiting_giver_choice") {
      const pending = round2.game_state.pendingGiverChoice!;
      const position = pending.pendingPositions[0];
      const candidates = bestCardCandidates(handOf(gameId, position), pending.levelRank);
      const response = await chooseGiverCard(gameId, playerIdByPosition[position], candidates[0]);
      expect(response.status).toBe(200);
      expect(((await response.json()) as ChooseGiverCardResponse).success).toBe(true);
      round2 = latestRound(gameId);
    }
    if (round2.status === "awaiting_tribute_choice") {
      const pending = round2.game_state.pendingTributeChoice!;
      const response = await chooseTribute(gameId, playerIdByPosition[firstFinisher], pending.thirdPosition);
      expect(response.status).toBe(200);
      expect(((await response.json()) as ChooseTributeResponse).success).toBe(true);
      round2 = latestRound(gameId);
    }

    // 7. Card exchange: submit every owed "return" (the automatic "initial"
    // half was already applied above).
    if (round2.status === "card_exchange") {
      const initialActions = (
        fake._tables.game_actions as unknown as {
          round_id: string;
          action_type: string;
          action_data: CardExchangeActionData;
        }[]
      ).filter((a) => a.round_id === round2.id && a.action_type === "card_exchange");
      expect(initialActions.length).toBeGreaterThan(0);

      for (const action of initialActions) {
        const { from, to } = action.action_data;
        const cardToReturn = handOf(gameId, to)[0];
        const returnResponse = await exchangeCards(gameId, playerIdByPosition[to], to, cardToReturn, from);
        expect(returnResponse.status).toBe(200);
        expect(((await returnResponse.json()) as ExchangeCardsResponse).success).toBe(true);
      }
    } else {
      expect(round2.status).toBe("in_progress"); // tribute cancelled (both red jokers held by the loser)
    }

    // 8. Round 2 activates in place once the exchange (or cancelled
    // tribute) resolves — there's no round 3 for this; the cards dealt back
    // in step 5 are what's actually played next.
    const nextRound = latestRound(gameId);
    expect(nextRound.round_number).toBe(2);
    expect(nextRound.status).toBe("in_progress");
    expect(nextRound.current_player_turn).not.toBeNull();
    expect(nextRound.game_state.currentTrick).toEqual([]);
    for (let position = 0 as PlayerPosition; position < 4; position++) {
      expect(handOf(gameId, position)).toHaveLength(27);
    }

    const gameRow = fake._tables.games.find((g) => g.id === gameId);
    expect(gameRow?.status).toBe("in_progress");

    const stateResponse = await getGameState(gameId, playerIdByPosition[0]);
    expect(stateResponse.status).toBe(200);
    const state = (await stateResponse.json()) as GameStateResponse;
    expect(state.round?.roundNumber).toBe(2);
    expect(state.myHand).toHaveLength(27);
  });
});
