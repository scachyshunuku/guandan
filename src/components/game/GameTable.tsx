"use client";

import { pluralize } from "@/lib/format";
import { PASS } from "@/lib/types";
import type { Game, GameParticipant, GameRound, PlayerPosition } from "@/lib/types";
import PlayerCard, { type SeatLabel } from "./PlayerCard";

export interface GameTableProps {
  game: Game;
  round: GameRound | null;
  participants: GameParticipant[];
  // The viewing client's own seat; null for spectators, who default to the
  // same orientation as position 0.
  myPosition: PlayerPosition | null;
}

// Seats laid out so turn order matches RULES.md ("Play moves
// counterclockwise"): the viewer always sits south, their partner (always
// the opposite seat) sits north, and turn order proceeds south -> east ->
// north -> west -> south.
const SEAT_LABELS: readonly SeatLabel[] = ["south", "east", "north", "west"];

function seatLabelFor(position: PlayerPosition, anchor: PlayerPosition): SeatLabel {
  const relative = (position - anchor + 4) % 4;
  return SEAT_LABELS[relative];
}

const SEAT_POSITIONS: readonly PlayerPosition[] = [0, 1, 2, 3];

// Main game board: 4 seats around a center trick area, plus the team score
// display. Doesn't render the viewer's own hand (PlayerHand, shown
// separately) or the full trick history (TrickDisplay, Task 5.3) — just
// enough of the current trick to show who's played what this round.
export default function GameTable({ game, round, participants, myPosition }: GameTableProps) {
  const anchor = myPosition ?? 0;
  const byPosition = new Map(
    participants
      .filter((p): p is GameParticipant & { position: PlayerPosition } => p.position !== null)
      .map((p) => [p.position, p]),
  );

  return (
    <div data-testid="game-table" className="flex flex-col items-center gap-4 p-4">
      <div data-testid="score-display" className="flex gap-6 text-sm font-medium">
        <span data-testid="team-a-level">Team A · Level {game.teamALevel}</span>
        <span data-testid="team-b-level">Team B · Level {game.teamBLevel}</span>
      </div>

      <div className="grid grid-cols-3 grid-rows-3 items-center justify-items-center gap-2">
        {SEAT_POSITIONS.map((position) => {
          const seatLabel = seatLabelFor(position, anchor);
          return (
            <div
              key={position}
              data-testid={`seat-${seatLabel}`}
              style={SEAT_GRID_AREA[seatLabel]}
            >
              {renderSeat(position, seatLabel, byPosition.get(position), round, myPosition)}
            </div>
          );
        })}

        <div
          data-testid="trick-area"
          style={{ gridColumn: 2, gridRow: 2 }}
          className="flex min-h-16 min-w-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 p-2 text-xs text-gray-500"
        >
          {renderTrickArea(round, anchor)}
        </div>
      </div>
    </div>
  );
}

const SEAT_GRID_AREA: Record<SeatLabel, { gridColumn: number; gridRow: number }> = {
  north: { gridColumn: 2, gridRow: 1 },
  west: { gridColumn: 1, gridRow: 2 },
  east: { gridColumn: 3, gridRow: 2 },
  south: { gridColumn: 2, gridRow: 3 },
};

function renderSeat(
  position: PlayerPosition,
  seatLabel: SeatLabel,
  participant: (GameParticipant & { position: PlayerPosition }) | undefined,
  round: GameRound | null,
  myPosition: PlayerPosition | null,
) {
  if (!participant) {
    return (
      <div data-testid="empty-seat" className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-400">
        Waiting for player
      </div>
    );
  }

  return (
    <PlayerCard
      playerName={participant.playerName}
      position={position}
      seatLabel={seatLabel}
      isConnected={participant.isConnected}
      cardCount={participant.hand.length}
      isCurrentTurn={round?.currentPlayerTurn === position}
      isSelf={myPosition === position}
    />
  );
}

function renderTrickArea(round: GameRound | null, anchor: PlayerPosition) {
  const trick = round?.gameState.currentTrick ?? [];

  if (trick.length === 0) {
    return <span data-testid="trick-empty">No cards played yet</span>;
  }

  return (
    <>
      {trick.map(({ position, play }, i) => {
        const seatLabel = seatLabelFor(position, anchor);
        return (
          <div key={i} data-testid="trick-play" data-position={position}>
            {seatLabel}: {play === PASS ? "Pass" : pluralize(play.length, "card")}
          </div>
        );
      })}
    </>
  );
}
