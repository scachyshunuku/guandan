"use client";

import { PASS } from "@/lib/types";
import type {
  GameParticipant,
  GameState,
  PlayerPosition,
  TrickPlay,
} from "@/lib/types";
import Card from "./Card";
import PlayerCard from "./PlayerCard";

export interface GameTableProps {
  round: {
    currentPlayerTurn: PlayerPosition | null;
    gameState: Pick<GameState, "currentTrick">;
  } | null;
  participants: GameParticipant[];
  // The viewing client's own seat; null for spectators.
  myPosition: PlayerPosition | null;
}

// Position order 0-3 always alternates Team A / Team B / Team A / Team B
// (Team A = positions 0 & 2, Team B = positions 1 & 3 — lib/types.ts's
// `Team` type), so listing seats in raw position order keeps that
// alternation on screen the same way for every viewer, rather than
// reseating players relative to whoever's looking.
const ALL_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// Main game board: one row per seat, each showing that player's info (name,
// team, connection, card count — PlayerCard) alongside whatever they've
// played so far this trick, so a player's icon and their play are always
// visible together rather than split between a seat grid and a separate
// trick summary. Doesn't render the viewer's own hand (PlayerHand, shown
// separately) or the score/history views (ScoreBoard/GameHistory, rendered
// as siblings by the page) — just the seats and the current trick.
export default function GameTable({
  round,
  participants,
  myPosition,
}: GameTableProps) {
  const byPosition = new Map(
    participants
      .filter(
        (p): p is GameParticipant & { position: PlayerPosition } =>
          p.position !== null,
      )
      .map((p) => [p.position, p]),
  );
  const playByPosition = new Map(
    (round?.gameState.currentTrick ?? []).map((entry) => [
      entry.position,
      entry.play,
    ]),
  );

  return (
    <div
      data-testid="game-table"
      className="flex w-full flex-col items-start gap-2 py-2 sm:gap-4 sm:py-4"
    >
      <div className="flex w-full max-w-md flex-col gap-2 sm:gap-3">
        {ALL_POSITIONS.map((position) => (
          <div
            key={position}
            data-testid={`seat-position-${position}`}
            className="flex items-center gap-3"
          >
            {renderSeat(position, byPosition.get(position), round, myPosition)}
            {renderPlay(playByPosition.get(position))}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderSeat(
  position: PlayerPosition,
  participant: (GameParticipant & { position: PlayerPosition }) | undefined,
  round: GameTableProps["round"],
  myPosition: PlayerPosition | null,
) {
  if (!participant) {
    return (
      <div
        data-testid="empty-seat"
        className="flex w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 px-3 py-2 text-center text-xs text-gray-400 sm:w-36"
      >
        Waiting for player
      </div>
    );
  }

  return (
    <PlayerCard
      playerName={participant.playerName}
      position={position}
      isConnected={participant.isConnected}
      cardCount={participant.handCount}
      isCurrentTurn={round?.currentPlayerTurn === position}
      isSelf={myPosition === position}
    />
  );
}

// undefined means this position hasn't acted yet this trick.
function renderPlay(play: TrickPlay | undefined) {
  if (play === undefined) {
    return (
      <span
        data-testid="trick-display-waiting"
        className="text-sm text-gray-300"
      >
        —
      </span>
    );
  }

  if (play === PASS) {
    return <PassCard />;
  }

  return (
    <div
      data-testid="trick-display-cards"
      className="flex flex-wrap gap-1 animate-card-in"
    >
      {play.map((card, cardIndex) => (
        <Card key={cardIndex} card={card} />
      ))}
    </div>
  );
}

// Card-shaped placeholder for a pass, sized to match Card.tsx so a row reads
// consistently whether a player played cards or passed.
function PassCard() {
  return (
    <div
      data-testid="trick-display-pass"
      className="flex h-20 w-14 animate-card-in items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-xs font-semibold tracking-wide text-gray-400 sm:h-24 sm:w-16"
    >
      PASS
    </div>
  );
}
