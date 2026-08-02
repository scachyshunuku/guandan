"use client";

import type {
  CardExchangeActionData,
  CardPlayedActionData,
  CardWithWild,
  GameAction,
  GameParticipant,
  JoinActionData,
  LeaveActionData,
  PlayerFinishedActionData,
  RoundEndedActionData,
  TrickEndActionData,
} from "@/lib/types";
import { encodeCard, isRedCard } from "@/lib/cardUtils";
import { nameForPosition, ordinalPlace } from "@/lib/format";
import TeamName from "./TeamName";

export interface GameHistoryProps {
  actions: GameAction[];
  // Resolves a position (card_played/card_exchange) or playerId (pass,
  // which unlike every other action type carries neither a name nor a
  // position - see the pass route's `action_data: {}`) back to a display
  // name, matching GameTable's participant lookup rather than showing
  // raw seat numbers. Falls back to a generic label if unresolvable (there's
  // no leave route yet - Task 6.2 - so today every position/playerId in the
  // log always resolves to a current participant).
  participants?: GameParticipant[];
  isLoading?: boolean;
  error?: Error | null;
}

// Full action-log replay/audit view (Task 6.3), backed by
// GET /api/game/[id]/history (Task 3.4) - unredacted across every round,
// unlike GameStateResponse.roundActions which only covers the current one.
// The API returns actions oldest-first (for replay); this view reverses
// that for display so the most recent action reads at the top.
export default function GameHistory({
  actions,
  participants = [],
  isLoading = false,
  error = null,
}: GameHistoryProps) {
  if (isLoading) {
    return (
      <p data-testid="game-history-loading" className="text-xs text-slate-500">
        Loading history…
      </p>
    );
  }

  if (error) {
    return (
      <p data-testid="game-history-error" className="text-xs text-red-500">
        {error.message}
      </p>
    );
  }

  if (actions.length === 0) {
    return (
      <p data-testid="game-history-empty" className="text-xs text-slate-500">
        No actions recorded yet.
      </p>
    );
  }

  return (
    <ul
      data-testid="game-history"
      className="flex flex-col gap-2 pb-2 text-xs text-slate-700"
    >
      {[...actions].reverse().map((action) => (
        <li
          key={action.id}
          data-testid="game-history-entry"
          data-action-type={action.actionType}
          className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2"
        >
          {renderEntry(action, participants)}
        </li>
      ))}
    </ul>
  );
}

function playerNameFor(playerId: string, participants: GameParticipant[]): string {
  return participants.find((p) => p.playerId === playerId)?.playerName ?? "A player";
}

function positionFor(playerId: string, participants: GameParticipant[]): number | null {
  return participants.find((p) => p.playerId === playerId)?.position ?? null;
}

// Compact acronym form of a card for the history log (e.g. "AD" for ace of
// diamonds, "RJ"/"BJ" for the jokers) — encodeCard already produces this
// shorthand for URL/storage purposes, so it's reused here rather than the
// full <Card> image, colored red/black by suit like a real card.
function CardLabel({ card }: { card: CardWithWild }) {
  return (
    <span data-testid="card-label" className={isRedCard(card) ? "text-red-600" : "text-gray-900"}>
      {encodeCard(card)}
    </span>
  );
}

function renderEntry(action: GameAction, participants: GameParticipant[]) {
  switch (action.actionType) {
    case "card_played": {
      const data = action.actionData as CardPlayedActionData;
      return (
        <>
          <span>
            <TeamName name={nameForPosition(data.position, participants)} position={data.position} />{" "}
            played
          </span>
          {data.cards.map((card, i) => (
            <CardLabel key={i} card={card} />
          ))}
        </>
      );
    }

    case "pass":
      return (
        <span>
          <TeamName
            name={playerNameFor(action.playerId, participants)}
            position={positionFor(action.playerId, participants)}
          />{" "}
          passed
        </span>
      );

    case "trick_end": {
      const data = action.actionData as TrickEndActionData;
      return (
        <span>
          Trick ended — won by{" "}
          <TeamName
            name={nameForPosition(data.winnerPosition, participants)}
            position={data.winnerPosition}
          />
        </span>
      );
    }

    case "player_finished": {
      const data = action.actionData as PlayerFinishedActionData;
      return (
        <span>
          <TeamName name={nameForPosition(data.position, participants)} position={data.position} />{" "}
          finished in {ordinalPlace(data.place)}
        </span>
      );
    }

    case "round_ended": {
      // Unlike "player_finished" above (only logged for a seat that actually
      // played out its last card), this always has all four seats' places -
      // RULES.md "Round End": a 1-2/1-3/1-4 finish auto-assigns at least one
      // seat's place without them playing it out.
      const data = action.actionData as RoundEndedActionData;
      return (
        <span>
          Round complete —{" "}
          {([1, 2, 3, 4] as const).map((place, i) => {
            const position = data.finishingPositions.indexOf(place);
            return (
              <span key={place}>
                {i > 0 && ", "}
                {ordinalPlace(place)}:{" "}
                <TeamName name={nameForPosition(position, participants)} position={position} />
              </span>
            );
          })}
        </span>
      );
    }

    case "card_exchange": {
      const data = action.actionData as CardExchangeActionData;
      return (
        <>
          <span>
            <TeamName name={nameForPosition(data.from, participants)} position={data.from} /> gave{" "}
            <TeamName name={nameForPosition(data.to, participants)} position={data.to} /> a card (
            {data.type})
          </span>
          <CardLabel card={data.card} />
        </>
      );
    }

    case "tribute_cancelled":
      // Not necessarily "the losing side" - in a 1-4 finish the sole giver
      // (4th place) is on the *winning* team, so this is worded around the
      // giver(s) themselves rather than team framing. See RULES.md "Card
      // Exchange" → "Cancelled if ...".
      return <span>Tribute cancelled — the tribute giver(s) held both Red Jokers</span>;

    case "join": {
      const data = action.actionData as JoinActionData;
      return (
        <span>
          <TeamName name={data.playerName} position={data.position} /> joined
          {data.position !== null ? ` at seat ${data.position + 1}` : " as a spectator"}
        </span>
      );
    }

    case "leave": {
      const data = action.actionData as LeaveActionData;
      return (
        <span>
          <TeamName name={data.playerName} position={data.position} /> left
          {data.position !== null ? ` seat ${data.position + 1}` : " (was spectating)"}
        </span>
      );
    }

    default:
      // Defensive fallback for a future action type this component hasn't
      // been taught to describe yet - better than a silently blank row.
      return <span>Unknown action</span>;
  }
}
