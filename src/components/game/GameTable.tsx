"use client";

import { type SeatLabel, seatLabelFor } from "@/lib/seating";
import { PASS } from "@/lib/types";
import type {
  Game,
  GameParticipant,
  GameState,
  PlayerPosition,
  TrickPlay,
} from "@/lib/types";
import Card from "./Card";
import PlayerCard from "./PlayerCard";

export interface GameTableProps {
  game: Pick<Game, "teamALevel" | "teamBLevel">;
  round: {
    currentPlayerTurn: PlayerPosition | null;
    gameState: Pick<GameState, "currentTrick">;
  } | null;
  participants: GameParticipant[];
  // The viewing client's own seat; null for spectators, who default to the
  // same orientation as position 0.
  myPosition: PlayerPosition | null;
}

const ALL_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// Top-to-bottom the way these seats sat around the old compass grid:
// partner (north) first, opponents (west/east) in the middle, the viewer
// (south) last.
const SEAT_ORDER: readonly SeatLabel[] = ["north", "west", "east", "south"];

// Main game board: one row per seat, each showing that player's info (name,
// connection, card count — PlayerCard) alongside whatever they've played so
// far this trick, so a player's icon and their play are always visible
// together rather than split between a seat grid and a separate trick
// summary. Doesn't render the viewer's own hand (PlayerHand, shown
// separately) or the score/history views (ScoreBoard/GameHistory) — just
// enough of the current trick and levels to show table state at a glance.
export default function GameTable({
  game,
  round,
  participants,
  myPosition,
}: GameTableProps) {
  const anchor = myPosition ?? 0;
  const byPosition = new Map(
    participants
      .filter(
        (p): p is GameParticipant & { position: PlayerPosition } =>
          p.position !== null,
      )
      .map((p) => [p.position, p]),
  );
  const positionForSeat = new Map(
    ALL_POSITIONS.map((position) => [seatLabelFor(position, anchor), position]),
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
      className="flex w-full flex-col items-center gap-2 p-2 sm:gap-4 sm:p-4"
    >
      <div
        data-testid="score-display"
        className="flex gap-3 text-sm font-medium sm:gap-6"
      >
        <span data-testid="team-a-level">Team A · Level {game.teamALevel}</span>
        <span data-testid="team-b-level">Team B · Level {game.teamBLevel}</span>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2 sm:gap-3">
        {SEAT_ORDER.map((seatLabel) => {
          const position = positionForSeat.get(seatLabel) as PlayerPosition;
          return (
            <div
              key={seatLabel}
              data-testid={`seat-${seatLabel}`}
              className="flex items-center gap-3"
            >
              {renderSeat(
                position,
                byPosition.get(position),
                round,
                myPosition,
              )}
              {renderPlay(playByPosition.get(position))}
            </div>
          );
        })}
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
        className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400"
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
