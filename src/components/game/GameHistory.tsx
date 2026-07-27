"use client";

import type {
  CardExchangeActionData,
  CardPlayedActionData,
  GameAction,
  GameParticipant,
  JoinActionData,
  LeaveActionData,
  PlayerFinishedActionData,
  TrickEndActionData,
} from "@/lib/types";
import Card from "./Card";

export interface GameHistoryProps {
  actions: GameAction[];
  // Resolves a position (card_played/card_exchange) or playerId (pass,
  // which unlike every other action type carries neither a name nor a
  // position - see the pass route's `action_data: {}`) back to a display
  // name, matching TrickDisplay's participant lookup rather than showing
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
      className="flex max-h-64 flex-col gap-2 overflow-y-auto text-xs text-slate-700"
    >
      {[...actions].reverse().map((action) => (
        <li
          key={action.id}
          data-testid="game-history-entry"
          data-action-type={action.actionType}
          className="flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2"
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

function nameForPosition(position: number, participants: GameParticipant[]): string {
  return participants.find((p) => p.position === position)?.playerName ?? `Position ${position}`;
}

function renderEntry(action: GameAction, participants: GameParticipant[]) {
  switch (action.actionType) {
    case "card_played": {
      const data = action.actionData as CardPlayedActionData;
      return (
        <>
          <span>{nameForPosition(data.position, participants)} played</span>
          {data.cards.map((card, i) => (
            <Card key={i} card={card} />
          ))}
        </>
      );
    }

    case "pass":
      return <span>{playerNameFor(action.playerId, participants)} passed</span>;

    case "trick_end": {
      const data = action.actionData as TrickEndActionData;
      return <span>Trick ended — won by {nameForPosition(data.winnerPosition, participants)}</span>;
    }

    case "player_finished": {
      const data = action.actionData as PlayerFinishedActionData;
      return (
        <span>
          {nameForPosition(data.position, participants)} finished in position {data.place}
        </span>
      );
    }

    case "card_exchange": {
      const data = action.actionData as CardExchangeActionData;
      return (
        <>
          <span>
            {nameForPosition(data.from, participants)} gave {nameForPosition(data.to, participants)}{" "}
            a card ({data.type})
          </span>
          <Card card={data.card} />
        </>
      );
    }

    case "join": {
      const data = action.actionData as JoinActionData;
      return (
        <span>
          {data.playerName} joined
          {data.position !== null ? ` at seat ${data.position + 1}` : " as a spectator"}
        </span>
      );
    }

    case "leave": {
      const data = action.actionData as LeaveActionData;
      return (
        <span>
          {data.playerName} left
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
