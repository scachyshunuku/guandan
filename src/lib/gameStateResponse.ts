// Builds GameStateResponse from mapped DB rows. Separated from the route
// handler so the hand-privacy behavior (RULES.md / ARCHITECTURE.md section
// 14: a player's hand must never reach anyone else's client) is unit
// testable without a live Supabase connection.

import type { CardWithWild, GameAction, GameParticipant, GameStateResponse } from "@/lib/types";

// Returns participants with every hand redacted except the requesting
// player's own, plus that player's hand pulled out separately. A
// requestingPlayerId that doesn't match any participant (spectator, or
// omitted) gets an empty myHand and every hand redacted.
export function redactParticipantHands(
  participants: GameParticipant[],
  requestingPlayerId: string | null
): { participants: GameParticipant[]; myHand: CardWithWild[] } {
  let myHand: CardWithWild[] = [];

  const participantsWithRedactedHands = participants.map((participant) => {
    if (requestingPlayerId !== null && participant.playerId === requestingPlayerId) {
      myHand = participant.hand;
      return participant;
    }
    return { ...participant, hand: [] };
  });

  return { participants: participantsWithRedactedHands, myHand };
}

export function buildGameStateResponse(
  game: GameStateResponse["game"],
  round: GameStateResponse["round"],
  participants: GameParticipant[],
  requestingPlayerId: string | null,
  roundActions: GameAction[]
): GameStateResponse {
  const { participants: redactedParticipants, myHand } = redactParticipantHands(
    participants,
    requestingPlayerId
  );

  return {
    game,
    round,
    participants: redactedParticipants,
    myHand,
    roundActions,
  };
}
