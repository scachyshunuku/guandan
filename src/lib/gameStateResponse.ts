// Builds GameStateResponse from mapped DB rows. Separated from the route
// handler so the hand-privacy behavior (RULES.md / ARCHITECTURE.md section
// 14: a player's hand must never reach anyone else's client) is unit
// testable without a live Supabase connection.

import type { CardWithWild, GameAction, GameParticipant, GameStateResponse } from "@/lib/types";
import { isHeartbeatRecent } from "@/lib/presence";

// Returns participants with every hand (and hand_order — see
// GameParticipant.handOrder's doc comment, its slot keys encode actual card
// identity the same as hand itself) redacted except the requesting player's
// own, plus that player's hand/handOrder pulled out separately. A
// requestingPlayerId that doesn't match any participant (spectator, or
// omitted) gets an empty myHand, a null myHandOrder, and every hand/
// handOrder redacted. Also re-derives `isConnected` from `lastHeartbeat`
// rather than trusting the stored column outright - the heartbeat route
// (Task 6.2) only flips a stale participant's stored value on some *other*
// participant's next heartbeat, so a client loading state fresh (initial
// load, or after everyone else has also gone quiet) would otherwise see a
// leftover `true` from before anyone went stale.
export function redactParticipantHands(
  participants: GameParticipant[],
  requestingPlayerId: string | null
): { participants: GameParticipant[]; myHand: CardWithWild[]; myHandOrder: string[] | null } {
  let myHand: CardWithWild[] = [];
  let myHandOrder: string[] | null = null;

  const participantsWithRedactedHands = participants.map((participant) => {
    const isConnected = isHeartbeatRecent(participant.lastHeartbeat);
    if (requestingPlayerId !== null && participant.playerId === requestingPlayerId) {
      myHand = participant.hand;
      myHandOrder = participant.handOrder;
      return { ...participant, isConnected };
    }
    return { ...participant, hand: [], handOrder: null, isConnected };
  });

  return { participants: participantsWithRedactedHands, myHand, myHandOrder };
}

export function buildGameStateResponse(
  game: GameStateResponse["game"],
  round: GameStateResponse["round"],
  participants: GameParticipant[],
  requestingPlayerId: string | null,
  roundActions: GameAction[]
): GameStateResponse {
  const { participants: redactedParticipants, myHand, myHandOrder } = redactParticipantHands(
    participants,
    requestingPlayerId
  );

  return {
    game,
    round,
    participants: redactedParticipants,
    myHand,
    myHandOrder,
    roundActions,
  };
}
