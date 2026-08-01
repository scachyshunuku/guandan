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
  // A trick can go around the table more than once (RULES.md — it only ends
  // after three consecutive passes), so the same position can carry several
  // plays this trick. Group them in chronological order per seat rather than
  // collapsing to the latest, so the full trick history stays visible.
  const playsByPosition = new Map<PlayerPosition, TrickPlay[]>();
  for (const entry of round?.gameState.currentTrick ?? []) {
    const existing = playsByPosition.get(entry.position);
    if (existing) {
      existing.push(entry.play);
    } else {
      playsByPosition.set(entry.position, [entry.play]);
    }
  }
  const maxRounds = Math.max(
    1,
    ...ALL_POSITIONS.map((position) => playsByPosition.get(position)?.length ?? 0),
  );

  return (
    <div
      data-testid="game-table"
      className="flex w-full flex-col items-start gap-2 py-2 sm:gap-4 sm:py-4"
    >
      {/* One shared grid (not four independent rows) so a given round's
          plays land in the same column for every seat. Wrapped in
          overflow-x-auto rather than letting a long-running trick's cards
          wrap onto a second line, which reads as a mess once several seats
          have gone around more than once. The seat column stays sticky so
          it's still visible after scrolling to see later rounds. */}
      <div className="w-full overflow-x-auto">
        <div
          className="grid items-center gap-x-2 gap-y-2 sm:gap-y-3"
          style={{ gridTemplateColumns: `auto repeat(${maxRounds}, auto)` }}
        >
          {ALL_POSITIONS.map((position, rowIndex) => (
            // display:contents keeps this element out of the box tree so
            // its children are the grid's actual items (and so every seat's
            // Nth-round column lines up with every other seat's), while
            // still giving the seat + its plays a shared testid ancestor
            // for tests to query into, same as when they were a flex row.
            <div
              key={position}
              data-testid={`seat-position-${position}`}
              className="contents"
            >
              <div
                className="sticky left-0 z-10 bg-slate-100"
                style={{ gridRow: rowIndex + 1, gridColumn: 1 }}
              >
                {renderSeat(position, byPosition.get(position), round, myPosition)}
              </div>
              {renderPlays(playsByPosition.get(position), rowIndex)}
            </div>
          ))}
        </div>
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

// undefined/empty means this position hasn't acted yet this trick. `plays`
// is oldest-first (turn order) and each entry is rendered into the grid
// column matching its round number (index + 2 — column 1 is the seat), so
// round 1 lines up under every other seat's round 1, round 2 under round 2,
// and so on, rather than each seat's plays only lining up with themselves.
function renderPlays(plays: TrickPlay[] | undefined, rowIndex: number) {
  if (!plays || plays.length === 0) {
    return (
      <span
        data-testid="trick-display-waiting"
        className="text-sm text-gray-300"
        style={{ gridRow: rowIndex + 1, gridColumn: 2 }}
      >
        —
      </span>
    );
  }

  return plays.map((play, i) => (
    <div
      key={i}
      data-testid="trick-display-round"
      className={`flex items-center ${
        i > 0 ? "border-l border-gray-200 pl-2" : ""
      }`}
      style={{ gridRow: rowIndex + 1, gridColumn: i + 2 }}
    >
      {play === PASS ? (
        <PassCard />
      ) : (
        <div
          data-testid="trick-display-cards"
          className="flex gap-1 animate-card-in"
        >
          {play.map((card, cardIndex) => (
            <Card key={cardIndex} card={card} />
          ))}
        </div>
      )}
    </div>
  ));
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
