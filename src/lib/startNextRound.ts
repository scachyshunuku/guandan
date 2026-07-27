// Starts the round after a just-finished hand — shared by end-hand/route.ts
// (calls this once a hand concludes). RULES.md "Card Exchange (After Each
// Round)": the next round's 27 cards are shuffled and dealt *immediately*,
// before any tribute card is given or returned — the whole exchange (the
// automatic "best card" giving, the both-Red-Jokers cancellation check, any
// tie-break choices, and the player-selected return) is evaluated against
// this freshly-dealt hand, not whatever was left over from the hand that
// just ended. This function deals the hand, plans the initial exchange
// against it (gameRules/cardExchange.ts), and creates the new round already
// in the right status for wherever that plan lands:
//   - cancelled (both Red Jokers held by the losing side) -> 'in_progress'
//     immediately, 1st place leads (RULES.md "Cancelled tribute")
//   - a giver's own tie needs resolving -> 'awaiting_giver_choice'
//     (choose-giver-card/route.ts)
//   - 3rd/4th's cards tie against each other -> 'awaiting_tribute_choice'
//     (choose-tribute/route.ts)
//   - fully resolved -> 'card_exchange', initial transfers applied and
//     logged, waiting on exchange-cards/route.ts to collect the returns
// Callers are responsible for their own compare-and-swap that claims the
// *previous* round's completion (and for reverting it if this function
// reports "error") — this function only ever inserts a new round row and
// deals into it, so it has nothing of its own to double-claim against.
import { supabaseAdmin } from "./supabaseAdmin";
import type { ParticipantRow } from "./gameDb";
import { dealHands } from "./deck";
import { broadcastToGame } from "./realtimeBroadcast";
import {
  computeExchangeHandWrites,
  leaderPositionForTransfers,
  planInitialExchanges,
  type ParticipantHands,
} from "./gameRules/cardExchange";
import type { FinishCombo } from "./gameRules/scoring";
import type {
  CardExchangeActionData,
  CardWithWild,
  GameState,
  PlayerPosition,
  RoundStatus,
  StandardRank,
} from "./types";

export type StartNextRoundOutcome = "started" | "error";

export async function startNextRound(
  gameId: string,
  previousRoundNumber: number,
  finishingPositions: readonly number[],
  combo: FinishCombo,
  playerId: string,
  // The *new* hand's level (the higher of the two post-promotion team
  // levels) — these are the cards about to be played at that level, not the
  // just-finished hand's cards, so this is what both dealHands()'s sort and
  // the tribute plan's best-card comparison need.
  levelRank: StandardRank,
  // The caller's own getGameContext() read, not re-fetched here — nothing
  // writes to game_participants between that read and this call (the round
  // is already frozen by the caller's own claim by the time it calls this),
  // so a second `select` would only ever return the same rows.
  participants: readonly ParticipantRow[],
): Promise<StartNextRoundOutcome> {
  const seated = participants.filter(
    (p): p is typeof p & { position: PlayerPosition } => p.position !== null,
  );

  const hands = dealHands(levelRank);
  const seatedWithNewHands: ParticipantHands[] = seated.map((p) => ({
    position: p.position,
    hand: hands[p.position],
  }));
  const finalHandByPosition = new Map<PlayerPosition, CardWithWild[]>(
    seatedWithNewHands.map((p) => [p.position, p.hand]),
  );

  const plan = planInitialExchanges(combo, finishingPositions, seatedWithNewHands, levelRank);
  const firstPos = finishingPositions.indexOf(1) as PlayerPosition;

  let status: RoundStatus;
  let leaderPosition: PlayerPosition | null = null;
  let gameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  let transferActionData: CardExchangeActionData[] = [];

  if (plan.cancelled) {
    // RULES.md "Cancelled tribute": no card-giver to hand leadership to, so
    // 1st place leads instead, and the round is playable right away.
    status = "in_progress";
    leaderPosition = firstPos;
  } else if (plan.needsGiverChoice) {
    status = "awaiting_giver_choice";
    gameState = {
      ...gameState,
      pendingGiverChoice: {
        levelRank,
        pendingPositions: plan.givers.map((g) => g.position),
        resolvedCards: {},
      },
    };
  } else if (plan.needsChoice) {
    status = "awaiting_tribute_choice";
    gameState = {
      ...gameState,
      pendingTributeChoice: {
        thirdPosition: plan.thirdPosition,
        thirdCard: plan.thirdCard,
        fourthPosition: plan.fourthPosition,
        fourthCard: plan.fourthCard,
      },
    };
  } else {
    // Fully resolved — apply the transfers on top of the new deal now, and
    // set leader_position immediately (RULES.md "Leader Selection": whoever
    // gave up the tribute card that went to 1st place). The round isn't
    // playable yet (current_player_turn stays null, status is
    // 'card_exchange') — resolveTurn/play-cards gate on status ===
    // 'in_progress' first, so a populated leader_position here is inert
    // until exchange-cards/route.ts activates the round once every return is
    // in.
    status = "card_exchange";
    leaderPosition = leaderPositionForTransfers(plan.transfers, firstPos);
    for (const write of computeExchangeHandWrites(seatedWithNewHands, plan.transfers)) {
      finalHandByPosition.set(write.position, write.newHand);
    }
    transferActionData = plan.transfers.map((t) => ({ from: t.from, to: t.to, card: t.card, type: "initial" }));
  }

  const newRoundInsert = await supabaseAdmin
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: previousRoundNumber + 1,
      game_state: gameState,
      leader_position: leaderPosition,
      current_player_turn: status === "in_progress" ? leaderPosition : null,
      status,
      // The *previous* hand's finishing order — this round's own hasn't
      // happened yet. Carried over (rather than left null until this round
      // concludes) because it's exactly what determines 1st/2nd/3rd/4th for
      // the tribute exchange this round is starting with: choose-giver-card/
      // choose-tribute read it off *this* round to resolve their own
      // choices, and the client needs it too (GameStateResponse ->
      // TributeChoiceModal's isFirstPlace, gameStore.ts) to know who's 1st
      // place while that exchange is in progress. Once this round eventually
      // concludes on its own, end-hand overwrites this with this round's own
      // finishing order, same as any other round.
      finishing_positions: finishingPositions,
    })
    .select("*")
    .single();
  if (newRoundInsert.error || !newRoundInsert.data) {
    console.error("Failed to create next round", newRoundInsert.error);
    return "error";
  }
  const newRound = newRoundInsert.data;

  const dealWrites = seated.map((p) => ({
    id: p.id,
    originalHand: p.hand,
    newHand: finalHandByPosition.get(p.position)!,
  }));

  const [handResults, actionResults] = await Promise.all([
    Promise.all(
      dealWrites.map((w) => supabaseAdmin.from("game_participants").update({ hand: w.newHand }).eq("id", w.id)),
    ),
    Promise.all(
      transferActionData.map((actionData) =>
        supabaseAdmin
          .from("game_actions")
          .insert({
            game_id: gameId,
            round_id: newRound.id,
            player_id: playerId,
            action_type: "card_exchange",
            action_data: actionData,
          })
          .select("*")
          .single(),
      ),
    ),
  ]);
  const dealFailure = handResults.find((r) => r.error);
  const actionFailure = actionResults.find((r) => r.error);
  if (dealFailure || actionFailure) {
    console.error(
      "Failed to deal/plan the next round; rolling back",
      dealFailure?.error,
      actionFailure?.error,
    );
    await Promise.all([
      supabaseAdmin.from("game_rounds").delete().eq("id", newRound.id),
      ...dealWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
      ),
      ...actionResults
        .filter((r) => !r.error && r.data != null)
        .map((r) => supabaseAdmin.from("game_actions").delete().eq("id", (r.data as { id: string }).id)),
    ]);
    return "error";
  }

  await Promise.all([
    broadcastToGame(gameId, "round_updated", newRound),
    ...actionResults.map((r) => broadcastToGame(gameId, "game_action", r.data)),
  ]);
  return "started";
}
