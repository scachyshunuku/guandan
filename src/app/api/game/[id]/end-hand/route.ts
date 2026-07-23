// POST /api/game/[id]/end-hand — see ARCHITECTURE.md section 7 ("End Hand /
// Level") and IMPLEMENTATION.md Task 3.3. Once a round has concluded (Task
// 3.2's play-cards freezes it by setting current_player_turn to null once
// detectRoundEnd is satisfied), this resolves the finishing positions,
// applies the level promotion, and checks the game-win condition. If the
// game isn't won outright, it also computes the automatic "initial" half of
// the card exchange (RULES.md "Card Exchange (After Each Round)") and moves
// the round into 'card_exchange' so exchange-cards (this task's other
// route) can collect the player-selected "return" half.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getGameContext,
  levelRankForGame,
  type GameRow,
  type GameRoundRow,
  type ParticipantRow,
} from "@/lib/gameDb";
import { compareCards, removeCardsFromHand } from "@/lib/cardUtils";
import { parseJsonBody } from "@/lib/http";
import { broadcastToGame } from "@/lib/realtimeBroadcast";
import {
  ACE_LEVEL,
  calculateLevelPromotion,
  detectRoundEnd,
  getFinishResult,
  type FinishCombo,
} from "@/lib/gameRules/scoring";
import type {
  CardExchangeActionData,
  CardWithWild,
  EndHandRequest,
  EndHandResponse,
  PlayerPosition,
  StandardRank,
} from "@/lib/types";

interface ExchangeTransfer {
  from: PlayerPosition;
  to: PlayerPosition;
  card: CardWithWild;
}

function bestCard(hand: readonly CardWithWild[], levelRank: StandardRank): CardWithWild {
  return hand.reduce((best, card) => (compareCards(card, best, levelRank) > 0 ? card : best));
}

// The automatic "initial" half of RULES.md "Card Exchange (After Each
// Round)": who gives which card to whom, before either recipient has made
// any choice of their own. `levelRank` is this *just-finished* hand's level
// (the higher of the two pre-promotion team levels) — the card values in
// effect while that hand's cards were actually in play.
function planInitialExchanges(
  combo: FinishCombo,
  finishingPositions: readonly number[],
  participants: readonly ParticipantRow[],
  levelRank: StandardRank,
): ExchangeTransfer[] {
  const posByRank = (rank: number) => finishingPositions.indexOf(rank) as PlayerPosition;
  const handOf = (position: PlayerPosition) =>
    participants.find((p) => p.position === position)!.hand;

  const firstPos = posByRank(1);
  const fourthPos = posByRank(4);
  const fourthCard = bestCard(handOf(fourthPos), levelRank);

  if (combo !== "1-2") {
    // Single-team lead (RULES.md "Single-Team Lead"): 4th's best card goes
    // to 1st, no other exchange.
    return [{ from: fourthPos, to: firstPos, card: fourthCard }];
  }

  // Two-team lead (RULES.md "Two-Team Lead"): 3rd and 4th both give their
  // best card; the higher rank goes to 1st, the lower to 2nd. RULES.md has
  // 1st choose which card to take when the two are tied in rank — there's
  // no interactive step for that decision yet, so a tie instead falls back
  // to compareCards' full ordering (which breaks rank ties by suit), the
  // same total order this codebase already uses everywhere else "which
  // card is better" comes up.
  const secondPos = posByRank(2);
  const thirdPos = posByRank(3);
  const thirdCard = bestCard(handOf(thirdPos), levelRank);
  const thirdIsHigher = compareCards(thirdCard, fourthCard, levelRank) > 0;
  return [
    { from: thirdPos, to: thirdIsHigher ? firstPos : secondPos, card: thirdCard },
    { from: fourthPos, to: thirdIsHigher ? secondPos : firstPos, card: fourthCard },
  ];
}

// Resolves each transfer against the participants' current hands into a
// flat list of per-participant hand writes. A map keyed by position (not a
// direct mutation of the participant rows) so a from/to pair that happened
// to share a position would still compose correctly — even though today's
// transfers never do (from is always 3rd/4th, to is always 1st/2nd).
function computeExchangeHandWrites(
  participants: readonly ParticipantRow[],
  transfers: readonly ExchangeTransfer[],
): { id: string; originalHand: CardWithWild[]; newHand: CardWithWild[] }[] {
  const byPosition = new Map<PlayerPosition, ParticipantRow>();
  for (const p of participants) {
    if (p.position !== null) byPosition.set(p.position, p);
  }

  const newHandByPosition = new Map<PlayerPosition, CardWithWild[]>();
  for (const { from, to, card } of transfers) {
    const fromHand = newHandByPosition.get(from) ?? byPosition.get(from)!.hand;
    const toHand = newHandByPosition.get(to) ?? byPosition.get(to)!.hand;
    newHandByPosition.set(from, removeCardsFromHand(fromHand, [card]));
    newHandByPosition.set(to, [...toHand, card]);
  }

  return [...newHandByPosition.entries()].map(([position, newHand]) => {
    const participant = byPosition.get(position)!;
    return { id: participant.id, originalHand: participant.hand, newHand };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;

  const parsed = await parseJsonBody<Partial<EndHandRequest>>(request);
  if (parsed.errorResponse) return parsed.errorResponse;
  const { playerId } = parsed.body;
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  const context = await getGameContext(gameId, playerId);
  if (!context) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const { game, round, participants, caller } = context;
  if (game.status !== "in_progress") {
    return NextResponse.json({ error: "Game is not in progress" }, { status: 400 });
  }
  if (!round || round.status !== "in_progress") {
    return NextResponse.json(
      { error: "Round is not awaiting hand-end resolution" },
      { status: 400 },
    );
  }
  if (!caller || caller.position === null) {
    return NextResponse.json(
      { error: "Only a seated player can end the hand" },
      { status: 403 },
    );
  }

  const finishingPositions = detectRoundEnd(round.game_state.finishOrder);
  if (!finishingPositions) {
    return NextResponse.json({ error: "Round has not concluded yet" }, { status: 400 });
  }

  // The level this just-finished hand was played at (RULES.md "Level Cards
  // & Wild Cards"), captured before promotion below changes it — that's
  // what the cards in players' hands were actually worth while this hand
  // was in play, which is what the initial exchange's "best card" needs.
  const levelRank = levelRankForGame(game);
  const { winningTeam, combo } = getFinishResult(finishingPositions);
  const [teamALevel, teamBLevel] = calculateLevelPromotion(finishingPositions, [
    game.team_a_level,
    game.team_b_level,
  ]);
  const promotedLevel = winningTeam === 0 ? teamALevel : teamBLevel;
  // RULES.md "Winning Condition": only a 1-2/1-3 finish that lands the
  // winning team AT level A ends the game outright — reaching A via a 1-4
  // (or already sitting at A and failing to repeat 1-2/1-3) just means they
  // "remain at level A and play another hand" instead. calculateLevelPromotion
  // already caps promotion at ACE_LEVEL for exactly that scenario.
  const gameEnded = promotedLevel === ACE_LEVEL && (combo === "1-2" || combo === "1-3");

  if (gameEnded) {
    return finalizeWonGame(game, round, finishingPositions, teamALevel, teamBLevel, winningTeam);
  }
  return finalizeContinuingHand(
    game,
    playerId,
    round,
    participants,
    finishingPositions,
    combo,
    levelRank,
    teamALevel,
    teamBLevel,
  );
}

async function finalizeWonGame(
  game: GameRow,
  round: GameRoundRow,
  finishingPositions: number[],
  teamALevel: number,
  teamBLevel: number,
  winningTeam: 0 | 1,
) {
  // Captured now, before any write: `round` came straight from
  // getLatestRound (unlike resolveTurn's callers, it isn't a defensive
  // shallow copy), so reading round.finishing_positions again after the
  // claim below has mutated it would see the *new* value, not the one a
  // rollback needs to restore.
  const originalFinishingPositions = round.finishing_positions;
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ finishing_positions: finishingPositions, status: "completed" })
    .eq("id", round.id)
    .eq("status", "in_progress")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim end-hand transition", roundClaimResult.error);
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return NextResponse.json(
      { error: "hand was already ended by another request" },
      { status: 409 },
    );
  }

  const gameUpdateResult = await supabaseAdmin
    .from("games")
    .update({
      team_a_level: teamALevel,
      team_b_level: teamBLevel,
      status: "completed",
      winning_team: winningTeam,
    })
    .eq("id", game.id)
    .eq("status", "in_progress")
    .select("*");
  if (gameUpdateResult.error || !gameUpdateResult.data?.length) {
    console.error(
      "Failed to persist game-won state after claiming the round transition; rolling back",
      gameUpdateResult.error,
    );
    const { error: rollbackError } = await supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "completed");
    if (rollbackError) {
      console.error("Failed to roll back game_rounds after failed end-hand write", rollbackError);
    }
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data![0]),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

async function finalizeContinuingHand(
  game: GameRow,
  playerId: string,
  round: GameRoundRow,
  participants: ParticipantRow[],
  finishingPositions: number[],
  combo: FinishCombo,
  levelRank: StandardRank,
  teamALevel: number,
  teamBLevel: number,
) {
  // See finalizeWonGame's identical comment: capture before any write
  // mutates these same live row objects (round.finishing_positions,
  // game.team_a_level/team_b_level) out from under this function's still-held
  // references to them.
  const originalFinishingPositions = round.finishing_positions;
  const originalTeamALevel = game.team_a_level;
  const originalTeamBLevel = game.team_b_level;
  const roundClaimResult = await supabaseAdmin
    .from("game_rounds")
    .update({ finishing_positions: finishingPositions, status: "card_exchange" })
    .eq("id", round.id)
    .eq("status", "in_progress")
    .select("*");
  if (roundClaimResult.error) {
    console.error("Failed to claim end-hand transition", roundClaimResult.error);
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }
  const claimedRound = roundClaimResult.data?.[0];
  if (!claimedRound) {
    return NextResponse.json(
      { error: "hand was already ended by another request" },
      { status: 409 },
    );
  }

  const transfers = planInitialExchanges(combo, finishingPositions, participants, levelRank);
  const handWrites = computeExchangeHandWrites(participants, transfers);

  const [gameUpdateResult, handResults, actionResults] = await Promise.all([
    supabaseAdmin
      .from("games")
      .update({ team_a_level: teamALevel, team_b_level: teamBLevel })
      .eq("id", game.id)
      .eq("status", "in_progress")
      .select("*"),
    Promise.all(
      handWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.newHand }).eq("id", w.id),
      ),
    ),
    Promise.all(
      transfers.map((t) => {
        const actionData: CardExchangeActionData = {
          from: t.from,
          to: t.to,
          card: t.card,
          type: "initial",
        };
        return supabaseAdmin
          .from("game_actions")
          .insert({
            game_id: game.id,
            round_id: round.id,
            player_id: playerId,
            action_type: "card_exchange",
            action_data: actionData,
          })
          .select("*")
          .single();
      }),
    ),
  ]);

  const gameUpdateFailed = Boolean(gameUpdateResult.error) || !gameUpdateResult.data?.length;
  const failed = gameUpdateFailed || handResults.some((r) => r.error) || actionResults.some((r) => r.error);
  if (failed) {
    console.error(
      "Failed to persist end-hand side effects after claiming the transition; rolling back",
      gameUpdateResult.error,
      handResults.find((r) => r.error)?.error,
      actionResults.find((r) => r.error)?.error,
    );
    await rollbackEndHandTransition(
      game,
      round,
      originalFinishingPositions,
      originalTeamALevel,
      originalTeamBLevel,
      handWrites,
      actionResults,
    );
    return NextResponse.json({ error: "Failed to end hand" }, { status: 500 });
  }

  await Promise.all([
    broadcastToGame(game.id, "round_updated", claimedRound),
    broadcastToGame(game.id, "game_updated", gameUpdateResult.data![0]),
    ...actionResults.map((r) => broadcastToGame(game.id, "game_action", r.data)),
  ]);

  const response: EndHandResponse = { success: true };
  return NextResponse.json(response);
}

// Undoes a claimed round transition's downstream writes (level promotion,
// hand transfers, action log) after one of them fails partway. The round
// revert is conditional on the round still being 'card_exchange' — see
// play-cards/route.ts's rollbackClaim for why an unconditional revert would
// risk stomping a legitimate later write — while the games/hands/actions
// reverts are unconditional-by-id, since nothing else can touch this game's
// levels or these participants' hands until this same round cycles back to
// 'in_progress'.
async function rollbackEndHandTransition(
  game: GameRow,
  round: GameRoundRow,
  originalFinishingPositions: number[] | null,
  originalTeamALevel: number,
  originalTeamBLevel: number,
  handWrites: { id: string; originalHand: CardWithWild[] }[],
  actionResults: { data: unknown; error: unknown }[],
) {
  const results = await Promise.all([
    supabaseAdmin
      .from("game_rounds")
      .update({ finishing_positions: originalFinishingPositions, status: "in_progress" })
      .eq("id", round.id)
      .eq("status", "card_exchange"),
    supabaseAdmin
      .from("games")
      .update({ team_a_level: originalTeamALevel, team_b_level: originalTeamBLevel })
      .eq("id", game.id),
    ...handWrites.map((w) =>
      supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
    ),
    ...actionResults
      .filter((r): r is { data: { id: string }; error: null } => !r.error && r.data != null)
      .map((r) => supabaseAdmin.from("game_actions").delete().eq("id", r.data.id)),
  ]);
  for (const result of results) {
    if (result.error) {
      console.error("Failed to roll back game_rounds/games/hand state after failed end-hand write", result.error);
    }
  }
}
