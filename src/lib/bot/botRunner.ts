// Drives an all-bot game to completion (IMPLEMENTATION.md Phase 7): one
// action per iteration, dispatching on the current round's status and
// calling the exact same lib/gameActions functions a human's HTTP request
// would call. Re-reads fresh state from the DB every iteration — wasteful
// compared to threading state through, but this drives one game at a time
// for dev/testing, not a performance-sensitive path.
import { getGame, getLatestRound, getParticipants, levelRankForGame } from "@/lib/gameDb";
import { playCards } from "@/lib/gameActions/playCards";
import { pass } from "@/lib/gameActions/pass";
import { chooseGiverCard } from "@/lib/gameActions/chooseGiverCard";
import { chooseTribute } from "@/lib/gameActions/chooseTribute";
import { exchangeCards, getRoundCardExchangeActions, pendingReturnPositions } from "@/lib/gameActions/exchangeCards";
import { endHand } from "@/lib/gameActions/endHand";
import { chooseTrickAction } from "./chooseTrickAction";
import { pickExchangeReturnCard, pickGiverCard, pickTributeTake } from "./chooseExchange";
import { bestCardCandidates } from "@/lib/gameRules/cardExchange";
import type { ActionResult } from "@/lib/gameActions/actionResult";
import type { CardWithWild, PlayerPosition } from "@/lib/types";

export interface BotSeat {
  position: PlayerPosition;
  playerId: string;
}

export type DriveBotGameOutcome =
  | { outcome: "completed"; iterations: number }
  | { outcome: "stalled"; iterations: number; reason: string };

function handFor(participants: { player_id: string; hand: CardWithWild[] }[], playerId: string): CardWithWild[] {
  return participants.find((p) => p.player_id === playerId)?.hand ?? [];
}

// Every dispatch below is a sequential, single-caller loop, so the CAS/turn
// checks inside the gameActions functions can't legitimately fail — but a
// transient failure (e.g. a dropped DB write) would otherwise go unnoticed
// and just get silently retried next iteration until either it self-heals
// or the iteration cap burns down to a generic "stalled" with no specific
// cause. Failing fast here with the actual status/body turns that into an
// immediate, diagnosable stop instead.
function actionFailure(result: ActionResult<unknown>, iterations: number): DriveBotGameOutcome | null {
  if (result.status >= 400) {
    return {
      outcome: "stalled",
      iterations,
      reason: `bot action failed with status ${result.status}: ${JSON.stringify(result.body)}`,
    };
  }
  return null;
}

// Primary safety net against an infinite loop from a logic bug (the
// "stalled" returns above are faster, more diagnostic secondary guards).
// Generous relative to a single hand (at most a few hundred actions,
// bounded by ~27 cards/player × 4 players × up to a few responses each
// before a trick resolves) so a full game — which can take several dozen
// hands to reach level Ace with trivial, non-strategic bots — has real
// headroom rather than hitting the cap on a normal run.
const DEFAULT_MAX_ITERATIONS = 50_000;

export async function driveBotGame(
  gameId: string,
  bots: readonly BotSeat[],
  maxIterations = DEFAULT_MAX_ITERATIONS,
): Promise<DriveBotGameOutcome> {
  const botAt = (position: PlayerPosition) => bots.find((b) => b.position === position);

  for (let i = 0; i < maxIterations; i++) {
    const game = await getGame(gameId);
    if (!game) return { outcome: "stalled", iterations: i, reason: "game not found" };
    if (game.status === "completed") return { outcome: "completed", iterations: i };

    const round = await getLatestRound(gameId);
    if (!round) return { outcome: "stalled", iterations: i, reason: "no round found for an in-progress game" };

    if (round.status === "in_progress") {
      if (round.current_player_turn === null) {
        // playCards.ts freezes the round (current_player_turn: null) once
        // its outcome is determined — needs end-hand to resolve it. Any
        // seated player may call it.
        const result = await endHand(gameId, bots[0].playerId);
        const failure = actionFailure(result, i);
        if (failure) return failure;
        continue;
      }
      const actingBot = botAt(round.current_player_turn);
      if (!actingBot) {
        return { outcome: "stalled", iterations: i, reason: `no bot seated at position ${round.current_player_turn}` };
      }
      const participants = await getParticipants(gameId);
      const hand = handFor(participants, actingBot.playerId);
      const levelRank = levelRankForGame(game);
      const decision = chooseTrickAction(hand, round.game_state.currentTrick, levelRank);
      const result =
        decision.action === "play"
          ? await playCards(gameId, actingBot.playerId, decision.cards)
          : await pass(gameId, actingBot.playerId);
      const failure = actionFailure(result, i);
      if (failure) return failure;
      continue;
    }

    if (round.status === "awaiting_giver_choice") {
      const pending = round.game_state.pendingGiverChoice;
      if (!pending || pending.pendingPositions.length === 0) {
        return { outcome: "stalled", iterations: i, reason: "awaiting_giver_choice with no pending giver" };
      }
      const position = pending.pendingPositions[0];
      const bot = botAt(position);
      if (!bot) {
        return { outcome: "stalled", iterations: i, reason: `no bot seated at position ${position}` };
      }
      const participants = await getParticipants(gameId);
      const hand = handFor(participants, bot.playerId);
      const candidates = bestCardCandidates(hand, pending.levelRank);
      const result = await chooseGiverCard(gameId, bot.playerId, pickGiverCard(candidates));
      const failure = actionFailure(result, i);
      if (failure) return failure;
      continue;
    }

    if (round.status === "awaiting_tribute_choice") {
      const pending = round.game_state.pendingTributeChoice;
      const firstPos = round.finishing_positions?.indexOf(1);
      if (!pending || firstPos === undefined || firstPos === -1) {
        return { outcome: "stalled", iterations: i, reason: "awaiting_tribute_choice with no pending tribute" };
      }
      const bot = botAt(firstPos as PlayerPosition);
      if (!bot) {
        return { outcome: "stalled", iterations: i, reason: `no bot seated at position ${firstPos}` };
      }
      const result = await chooseTribute(gameId, bot.playerId, pickTributeTake(pending.thirdPosition));
      const failure = actionFailure(result, i);
      if (failure) return failure;
      continue;
    }

    if (round.status === "card_exchange") {
      const actions = await getRoundCardExchangeActions(round.id);
      const owed = pendingReturnPositions(actions);
      if (owed.length === 0) {
        return { outcome: "stalled", iterations: i, reason: "card_exchange with nothing owed" };
      }
      const bot = botAt(owed[0]);
      if (!bot) {
        return { outcome: "stalled", iterations: i, reason: `no bot seated at position ${owed[0]}` };
      }
      const participants = await getParticipants(gameId);
      const hand = handFor(participants, bot.playerId);
      const card = pickExchangeReturnCard(hand, levelRankForGame(game));
      const result = await exchangeCards(gameId, bot.playerId, card);
      const failure = actionFailure(result, i);
      if (failure) return failure;
      continue;
    }

    // round.status === "completed": shouldn't be hit mid-loop for the
    // latest round of a game that isn't itself 'completed' (the game.status
    // check above would have already caught that) — a fresh round always
    // replaces a completed one via startNextRound. Treat as a bug guard.
    return { outcome: "stalled", iterations: i, reason: `unexpected round status: ${round.status}` };
  }

  return { outcome: "stalled", iterations: maxIterations, reason: "iteration cap reached" };
}
