/**
 * @jest-environment node
 */
// Mixed human + bot game (IMPLEMENTATION.md Phase 8): a human plays
// alongside 3 bot-filled seats added via add-bot, with bot turns driven
// purely by repeated drive-bots calls - proving the actual human-facing
// wiring (add-bot, drive-bots, and the human's own
// play-cards/pass/choose-*/exchange-cards calls) works end to end to a full
// game's completion. The all-bot-only dev tool this superseded
// (seedBotMatch/driveBotGame/POST /api/game/dev/bot-match) has been
// removed - add-bot + drive-bots now cover that ground too (seat every
// position with a bot, same as any other mix).
//
// The human's own decisions reuse the same trivial heuristics the bots use
// (lib/bot/chooseTrickAction.ts, lib/bot/chooseExchange.ts) - this test
// isn't exercising human decision *quality* (see fullGameFlow.integration.
// test.ts for dedicated coverage of the giver/tribute/exchange routes), it
// only needs the human to make *some* legal choice each time it's their
// turn so the game can actually reach completion.
import type { FakeSupabaseClient } from "@/testUtils/fakeSupabase";

jest.mock("@/lib/supabaseAdmin");
jest.mock("@/lib/realtimeBroadcast");

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { create as createGame, join, start } from "@/testUtils/gameRouteHelpers";
import { POST as addBotRoute } from "./[id]/add-bot/route";
import { POST as driveBotsRoute } from "./[id]/drive-bots/route";
import { POST as playCardsRoute } from "./[id]/play-cards/route";
import { POST as passRoute } from "./[id]/pass/route";
import { POST as chooseGiverCardRoute } from "./[id]/choose-giver-card/route";
import { POST as chooseTributeRoute } from "./[id]/choose-tribute/route";
import { POST as exchangeCardsRoute } from "./[id]/exchange-cards/route";
import { levelRankForGame } from "@/lib/gameDb";
import { getRoundCardExchangeActions, pendingReturnPositions } from "@/lib/gameActions/exchangeCards";
import { bestCardCandidates } from "@/lib/gameRules/cardExchange";
import { chooseTrickAction } from "@/lib/bot/chooseTrickAction";
import { pickExchangeReturnCard, pickGiverCard, pickTributeTake } from "@/lib/bot/chooseExchange";
import type {
  Card,
  CardWithWild,
  CreateGameResponse,
  DriveBotsResponse,
  GameState,
  JoinGameResponse,
  PassResponse,
  PlayCardsResponse,
} from "@/lib/types";

const fake = supabaseAdmin as unknown as FakeSupabaseClient;

beforeEach(() => {
  fake._reset();
});

function addBot(gameId: string, playerId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/add-bot`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
  return addBotRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function driveBots(gameId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/drive-bots`, { method: "POST" });
  return driveBotsRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function playCards(gameId: string, playerId: string, cards: CardWithWild[]) {
  const request = new Request(`http://localhost/api/game/${gameId}/play-cards`, {
    method: "POST",
    body: JSON.stringify({ playerId, cards }),
  });
  return playCardsRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function pass(gameId: string, playerId: string) {
  const request = new Request(`http://localhost/api/game/${gameId}/pass`, {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
  return passRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function chooseGiverCard(gameId: string, playerId: string, card: Card) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-giver-card`, {
    method: "POST",
    body: JSON.stringify({ playerId, card }),
  });
  return chooseGiverCardRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function chooseTribute(gameId: string, playerId: string, take: number) {
  const request = new Request(`http://localhost/api/game/${gameId}/choose-tribute`, {
    method: "POST",
    body: JSON.stringify({ playerId, take }),
  });
  return chooseTributeRoute(request, { params: Promise.resolve({ id: gameId }) });
}

function exchangeCards(gameId: string, playerId: string, cardToGive: Card) {
  const request = new Request(`http://localhost/api/game/${gameId}/exchange-cards`, {
    method: "POST",
    body: JSON.stringify({ playerId, cardToGive }),
  });
  return exchangeCardsRoute(request, { params: Promise.resolve({ id: gameId }) });
}

interface RoundRow {
  id: string;
  game_id: string;
  round_number: number;
  game_state: GameState;
  current_player_turn: number | null;
  status: string;
  finishing_positions: number[] | null;
}

function latestRound(gameId: string): RoundRow {
  const rounds = (fake._tables.game_rounds as unknown as RoundRow[]).filter((r) => r.game_id === gameId);
  return rounds.reduce((latest, r) => (r.round_number > latest.round_number ? r : latest));
}

interface GameRow {
  id: string;
  status: string;
  team_a_level: number;
  team_b_level: number;
}

function gameRow(gameId: string): GameRow {
  return fake._tables.games.find((g) => g.id === gameId)! as unknown as GameRow;
}

function handOf(gameId: string, playerId: string): CardWithWild[] {
  return fake._tables.game_participants.find((p) => p.game_id === gameId && p.player_id === playerId)!
    .hand as CardWithWild[];
}

const HUMAN_POSITION = 0;

describe("mixed human + bot game", () => {
  it("plays a full game to completion, with a human's own moves interleaved with automatic bot turns", async () => {
    const { gameId } = (await (await createGame()).json()) as CreateGameResponse;

    const humanPlayerId = "human-1";
    const joinResponse = await join(gameId, "Alice", humanPlayerId);
    const joined = (await joinResponse.json()) as JoinGameResponse;
    expect(joined).toEqual({ spectator: false, position: HUMAN_POSITION, hand: [] });

    for (let i = 0; i < 3; i++) {
      const response = await addBot(gameId, humanPlayerId);
      expect(response.status).toBe(201);
    }
    const seededParticipants = fake._tables.game_participants.filter((p) => p.game_id === gameId);
    expect(seededParticipants.filter((p) => p.is_bot)).toHaveLength(3);

    const startResponse = await start(gameId, humanPlayerId);
    expect(startResponse.status).toBe(200);

    let iterations = 0;
    while (gameRow(gameId).status !== "completed") {
      iterations++;
      // Safety net against a genuine hang (a bug, not expected) - well
      // above what a real game needs (fullGameFlow's equivalent all-bot
      // run completes in low thousands of actions).
      expect(iterations).toBeLessThan(20_000);

      // Drain every bot action currently available - mirrors what the
      // client's polling actually converges to given enough ticks, without
      // this test waiting on real intervals. Correctly no-ops on the
      // human's own pending turn/choices (drive-bots/botRunner.test.ts
      // cover that directly).
      let acted = true;
      while (acted) {
        const response = await driveBots(gameId);
        expect(response.status).toBe(200);
        acted = ((await response.json()) as DriveBotsResponse).acted;
      }
      if (gameRow(gameId).status === "completed") break;

      const round = latestRound(gameId);
      const levelRank = levelRankForGame(gameRow(gameId));

      if (round.status === "in_progress" && round.current_player_turn === HUMAN_POSITION) {
        const decision = chooseTrickAction(handOf(gameId, humanPlayerId), round.game_state.currentTrick, levelRank);
        const response =
          decision.action === "play"
            ? await playCards(gameId, humanPlayerId, decision.cards)
            : await pass(gameId, humanPlayerId);
        expect(response.status).toBe(200);
        expect(((await response.json()) as PlayCardsResponse | PassResponse).success).toBe(true);
        continue;
      }

      if (round.status === "awaiting_giver_choice") {
        const pending = round.game_state.pendingGiverChoice!;
        if (pending.pendingPositions.includes(HUMAN_POSITION)) {
          const candidates = bestCardCandidates(handOf(gameId, humanPlayerId), pending.levelRank);
          const response = await chooseGiverCard(gameId, humanPlayerId, pickGiverCard(candidates));
          expect(response.status).toBe(200);
        }
        continue;
      }

      if (round.status === "awaiting_tribute_choice") {
        const pending = round.game_state.pendingTributeChoice!;
        if (round.finishing_positions?.indexOf(1) === HUMAN_POSITION) {
          const response = await chooseTribute(gameId, humanPlayerId, pickTributeTake(pending.thirdPosition));
          expect(response.status).toBe(200);
        }
        continue;
      }

      if (round.status === "card_exchange") {
        const actions = await getRoundCardExchangeActions(round.id);
        const owed = pendingReturnPositions(actions);
        if (owed.includes(HUMAN_POSITION)) {
          const card = pickExchangeReturnCard(handOf(gameId, humanPlayerId), levelRank);
          const response = await exchangeCards(gameId, humanPlayerId, card);
          expect(response.status).toBe(200);
        }
        continue;
      }

      // Nothing to do this tick (e.g. the round just hasn't been dealt into
      // yet) - loop back around; the iteration cap above is the guard
      // against this ever spinning forever.
    }

    expect(gameRow(gameId).status).toBe("completed");
    expect(Math.max(gameRow(gameId).team_a_level, gameRow(gameId).team_b_level)).toBe(14);
  });
});
