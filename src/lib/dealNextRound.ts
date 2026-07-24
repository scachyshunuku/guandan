// Deals a fresh round once a hand has fully concluded — shared by
// end-hand/route.ts (a tribute-cancelled hand has no return to wait on, so
// it deals immediately after finishing) and exchange-cards/route.ts (deals
// once every owed return is in). Callers are responsible for their own
// compare-and-swap that claims the *previous* round's completion (and for
// reverting it if this function reports "error") — this function only ever
// inserts a new round row and deals into it, so it has nothing of its own
// to double-claim against.
import { supabaseAdmin } from "./supabaseAdmin";
import { getParticipants } from "./gameDb";
import { dealHands } from "./deck";
import { broadcastToGame } from "./realtimeBroadcast";
import type { CardWithWild, GameState, PlayerPosition, StandardRank } from "./types";

export type DealNextRoundOutcome = "dealt" | "error";

export async function dealNextRound(
  gameId: string,
  previousRoundNumber: number,
  leaderPosition: PlayerPosition,
  levelRank: StandardRank,
): Promise<DealNextRoundOutcome> {
  const newGameState: GameState = { currentTrick: [], trickCount: 0, finishOrder: [] };
  const newRoundInsert = await supabaseAdmin
    .from("game_rounds")
    .insert({
      game_id: gameId,
      round_number: previousRoundNumber + 1,
      game_state: newGameState,
      leader_position: leaderPosition,
      current_player_turn: leaderPosition,
    })
    .select("*")
    .single();
  if (newRoundInsert.error || !newRoundInsert.data) {
    console.error("Failed to create next round", newRoundInsert.error);
    return "error";
  }

  // Fetched fresh here, not passed down from the caller's earlier read —
  // this hand's exchange (if any) has already landed by this point, and
  // dealing needs each seat's *current* hand as the rollback fallback
  // below, not a pre-exchange snapshot.
  const participants = await getParticipants(gameId);
  const seated = new Map<PlayerPosition, { id: string; hand: CardWithWild[] }>();
  for (const p of participants) {
    if (p.position !== null) seated.set(p.position, p);
  }

  const hands = dealHands(levelRank);
  const dealWrites = ([0, 1, 2, 3] as const).map((position) => {
    const participant = seated.get(position)!;
    return { id: participant.id, originalHand: participant.hand, newHand: hands[position] };
  });
  const dealResults = await Promise.all(
    dealWrites.map((w) => supabaseAdmin.from("game_participants").update({ hand: w.newHand }).eq("id", w.id)),
  );
  const dealFailure = dealResults.find((r) => r.error);
  if (dealFailure) {
    console.error("Failed to deal hands for the new round; rolling back", dealFailure.error);
    await Promise.all([
      supabaseAdmin.from("game_rounds").delete().eq("id", newRoundInsert.data.id),
      ...dealWrites.map((w) =>
        supabaseAdmin.from("game_participants").update({ hand: w.originalHand }).eq("id", w.id),
      ),
    ]);
    return "error";
  }

  await broadcastToGame(gameId, "round_updated", newRoundInsert.data);
  return "dealt";
}
