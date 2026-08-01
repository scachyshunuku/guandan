// Drives bot turns by dispatching on the current round's status and
// calling the exact same lib/gameActions functions a human's HTTP request
// would call (IMPLEMENTATION.md Phase 8). `driveOneBotAction` performs at
// most one action and reports what happened; the drive-bots route calls it
// once per client poll. "idle" (nothing a bot can do right now, e.g. it's a
// human's turn) is the normal, expected result most of the time, not an
// error.
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

// "idle"/"error" both carry a `reason` for diagnostics, but only "error"
// means something's actually wrong — see the drive-bots route for how it
// treats the distinction (idle is a normal no-op, error is surfaced as a
// failure).
export type BotStepOutcome =
  | { kind: "acted" }
  | { kind: "idle"; reason: string }
  | { kind: "completed" }
  | { kind: "error"; reason: string };

function handFor(participants: { player_id: string; hand: CardWithWild[] }[], playerId: string): CardWithWild[] {
  return participants.find((p) => p.player_id === playerId)?.hand ?? [];
}

// The CAS/turn checks inside the gameActions functions can't legitimately
// fail for a *correctly dispatched* call (this function only ever calls one
// on behalf of the position it's actually that position's turn/choice to
// act for) — but a transient failure (e.g. a dropped DB write) still needs
// surfacing distinctly rather than silently retried next call, so callers
// can fail fast instead of looping/polling forever on a real bug.
function actionFailureReason(result: ActionResult<unknown>): string | null {
  if (result.status >= 400) {
    return `bot action failed with status ${result.status}: ${JSON.stringify(result.body)}`;
  }
  return null;
}

// Performs at most one bot action: whichever the game's current state calls
// for, for whichever of `bots` is the position that owes it (if any).
export async function driveOneBotAction(
  gameId: string,
  bots: readonly BotSeat[],
): Promise<BotStepOutcome> {
  if (bots.length === 0) return { kind: "idle", reason: "no bot seats to act for" };
  const botAt = (position: PlayerPosition) => bots.find((b) => b.position === position);
  const act = (result: ActionResult<unknown>): BotStepOutcome => {
    const failure = actionFailureReason(result);
    return failure ? { kind: "error", reason: failure } : { kind: "acted" };
  };

  const game = await getGame(gameId);
  if (!game) return { kind: "error", reason: "game not found" };
  if (game.status === "completed") return { kind: "completed" };
  if (game.status === "waiting") return { kind: "idle", reason: "game has not started yet" };

  const round = await getLatestRound(gameId);
  if (!round) return { kind: "idle", reason: "no round found yet" };

  if (round.status === "in_progress") {
    if (round.current_player_turn === null) {
      // playCards.ts freezes the round (current_player_turn: null) once
      // its outcome is determined — needs end-hand to resolve it. Any
      // seated player may call it, so any bot seat works here.
      return act(await endHand(gameId, bots[0].playerId));
    }
    const actingBot = botAt(round.current_player_turn);
    if (!actingBot) return { kind: "idle", reason: `position ${round.current_player_turn} (whose turn it is) is not a bot` };
    const participants = await getParticipants(gameId);
    const hand = handFor(participants, actingBot.playerId);
    const levelRank = levelRankForGame(game);
    const decision = chooseTrickAction(hand, round.game_state.currentTrick, levelRank);
    return act(
      decision.action === "play"
        ? await playCards(gameId, actingBot.playerId, decision.cards)
        : await pass(gameId, actingBot.playerId),
    );
  }

  if (round.status === "awaiting_giver_choice") {
    const pending = round.game_state.pendingGiverChoice;
    if (!pending || pending.pendingPositions.length === 0) {
      return { kind: "error", reason: "awaiting_giver_choice with no pending giver" };
    }
    // Not necessarily pendingPositions[0]: in a mixed game a human giver
    // might be one of the pending positions too, and their pending choice
    // isn't ordered relative to a bot's — this bot should still act on its
    // own pending choice regardless of where it falls in the list.
    const position = pending.pendingPositions.find((p) => botAt(p) !== undefined);
    if (position === undefined) return { kind: "idle", reason: "no pending giver position is a bot" };
    const bot = botAt(position)!;
    const participants = await getParticipants(gameId);
    const hand = handFor(participants, bot.playerId);
    const candidates = bestCardCandidates(hand, pending.levelRank);
    return act(await chooseGiverCard(gameId, bot.playerId, pickGiverCard(candidates)));
  }

  if (round.status === "awaiting_tribute_choice") {
    const pending = round.game_state.pendingTributeChoice;
    const firstPos = round.finishing_positions?.indexOf(1);
    if (!pending || firstPos === undefined || firstPos === -1) {
      return { kind: "error", reason: "awaiting_tribute_choice with no pending tribute" };
    }
    const bot = botAt(firstPos as PlayerPosition);
    if (!bot) return { kind: "idle", reason: `position ${firstPos} (1st place, owes a tribute choice) is not a bot` };
    return act(await chooseTribute(gameId, bot.playerId, pickTributeTake(pending.thirdPosition)));
  }

  if (round.status === "card_exchange") {
    const actions = await getRoundCardExchangeActions(round.id);
    const owed = pendingReturnPositions(actions);
    if (owed.length === 0) {
      return { kind: "error", reason: "card_exchange with nothing owed" };
    }
    // Same reasoning as awaiting_giver_choice above: find *a* bot among
    // those owed, not necessarily the first position in the list.
    const owedPosition = owed.find((p) => botAt(p) !== undefined);
    if (owedPosition === undefined) return { kind: "idle", reason: "no pending card-exchange return position is a bot" };
    const bot = botAt(owedPosition)!;
    const participants = await getParticipants(gameId);
    const hand = handFor(participants, bot.playerId);
    const card = pickExchangeReturnCard(hand, levelRankForGame(game));
    return act(await exchangeCards(gameId, bot.playerId, card));
  }

  // round.status === "completed": shouldn't be hit for the latest round of
  // a game that isn't itself 'completed' (the game.status check above would
  // have already caught that) — a fresh round always replaces a completed
  // one via startNextRound. Bug guard, not a reachable state.
  return { kind: "error", reason: `unexpected round status: ${round.status}` };
}
