"use client";

import { useState } from "react";
import { useGameContext } from "./GameProvider";
import GameTable from "@/components/game/GameTable";
import PlayerHand from "@/components/game/PlayerHand";
import TrickDisplay from "@/components/game/TrickDisplay";
import ScoreBoard from "@/components/game/ScoreBoard";
import ActionButtons from "@/components/game/ActionButtons";
import { levelRankForLevels } from "@/lib/cardUtils";
import { gameShareLink, pluralize } from "@/lib/format";
import type { CardWithWild, GameParticipant, PlayerPosition } from "@/lib/types";

// Task 5.6's "Game board container": composes the board out of the pieces
// built in Tasks 5.1-5.4 (PlayerHand, GameTable, TrickDisplay, ScoreBoard,
// ActionButtons) around the single useGame() subscription GameProvider
// (Task 4.4) hands down via context. "Handle game state" means switching on
// gameStatus - the round doesn't exist yet while 'waiting' (GameStateResponse
// doc comment in lib/types.ts), so the board only renders once play starts.
export default function GamePage() {
  const {
    gameId,
    gameStatus,
    participants,
    myPosition,
    hand,
    currentTrick,
    currentPlayerTurn,
    teamLevels,
    winningTeam,
    isLoading,
    error,
    refetch,
    playCards,
    isPlayingCards,
    playCardsError,
    pass,
    isPassing,
    passError,
    joinGame,
    isJoiningGame,
    joinGameError,
    startGame,
    isStartingGame,
    startGameError,
  } = useGameContext();

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  if (isLoading) {
    return (
      <div data-testid="game-loading" className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Loading game…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="game-error" className="flex flex-1 items-center justify-center">
        <p className="text-sm text-red-500">{error.message}</p>
      </div>
    );
  }

  if (gameStatus === "waiting") {
    function handleJoin(playerName: string) {
      // joinGame's response isn't fed into the store (it only carries the
      // *new* participant's own seat/hand, and the store has no "is this
      // me" concept outside of the GET hydration in useGame's
      // applyGameState) - refetching is what actually sets myPosition/hand
      // for the just-joined player once the mutation resolves.
      joinGame(playerName)
        .then(() => refetch())
        .catch(() => {
          // Failure surfaces via joinGameError below.
        });
    }

    function handleStart() {
      startGame().catch(() => {
        // Failure surfaces via startGameError below (e.g. another seated
        // player already started it first - route.ts's 409).
      });
    }

    return (
      <WaitingRoom
        gameId={gameId}
        participants={participants}
        myPosition={myPosition}
        onJoin={handleJoin}
        isJoining={isJoiningGame}
        joinError={joinGameError}
        onStart={handleStart}
        isStarting={isStartingGame}
        startError={startGameError}
      />
    );
  }

  // TODO(Task 3.3): once end-hand/exchange-cards land, round.status can be
  // 'card_exchange' - this container will need a branch for it (rendering
  // CardExchangeModal.tsx instead of the board below). Unreachable today:
  // useGame doesn't even carry round.status yet, and no route ever sets it.
  const game = { teamALevel: teamLevels[0], teamBLevel: teamLevels[1], winningTeam };
  const round = { currentPlayerTurn, gameState: { currentTrick } };
  const isMyTurn = myPosition !== null && currentPlayerTurn === myPosition;
  const levelRank = levelRankForLevels(teamLevels[0], teamLevels[1]);

  function handlePlay(cards: CardWithWild[]) {
    setSelectedIndices([]);
    playCards(cards).catch(() => {
      // Failure surfaces via useGame's isPlayingCards/playCardsError state
      // and the optimistic hand/trick update is reverted automatically
      // (see useGame.ts) - nothing further to do here.
    });
  }

  function handlePass() {
    setSelectedIndices([]);
    pass().catch(() => {});
  }

  return (
    <main
      data-testid="game-page"
      className="flex flex-1 flex-col items-center gap-6 bg-slate-100 px-4 py-8"
    >
      <ScoreBoard game={game} />
      <GameTable game={game} round={round} participants={participants} myPosition={myPosition} />
      <TrickDisplay trick={currentTrick} participants={participants} />

      {gameStatus === "completed" ? (
        <p data-testid="game-over-message" className="text-sm font-semibold text-slate-700">
          Game over
        </p>
      ) : myPosition === null ? (
        <p data-testid="spectator-note" className="text-sm text-slate-500">
          You&apos;re spectating
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <PlayerHand
            hand={hand}
            selectedIndices={selectedIndices}
            onSelectionChange={setSelectedIndices}
          />
          <ActionButtons
            hand={hand}
            selectedCards={selectedIndices.map((index) => hand[index])}
            currentTrick={currentTrick}
            levelRank={levelRank}
            isMyTurn={isMyTurn}
            onPlay={handlePlay}
            onPass={handlePass}
            isSubmitting={isPlayingCards || isPassing}
          />
          {(playCardsError ?? passError) && (
            <p data-testid="action-error" className="text-xs text-red-500">
              {(playCardsError ?? passError)?.message}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

const SEAT_POSITIONS = [0, 1, 2, 3] as const;

function WaitingRoom({
  gameId,
  participants,
  myPosition,
  onJoin,
  isJoining,
  joinError,
  onStart,
  isStarting,
  startError,
}: {
  gameId: string;
  participants: GameParticipant[];
  // null both before this browser has joined at all (the creator landing
  // here straight from CreateGameForm's "Enter game" link, or anyone who
  // opens the shared link directly - neither goes through JoinGameForm on
  // the home page) and after joining as a spectator (all 4 seats already
  // taken). Either way, there's nothing more for them to do here, so both
  // show the join form below rather than only handling the first case.
  myPosition: PlayerPosition | null;
  onJoin: (playerName: string) => void;
  isJoining: boolean;
  joinError: Error | null;
  onStart: () => void;
  isStarting: boolean;
  startError: Error | null;
}) {
  const [playerName, setPlayerName] = useState("");
  const byPosition = new Map(
    participants.filter((p) => p.position !== null).map((p) => [p.position, p]),
  );
  const spectators = participants.filter((p) => p.position === null);
  // Only a seated player can start (route.ts's "Only a seated player can
  // start the game"), and only once all 4 seats are filled (its "Need 4
  // players to start") - pre-checked here so the button never fires a
  // doomed request, same as ActionButtons does for play/pass.
  const canStart = myPosition !== null && byPosition.size === 4;

  return (
    <main
      data-testid="waiting-room"
      className="flex flex-1 flex-col items-center gap-6 bg-slate-100 px-4 py-16"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold text-slate-900">Waiting for players…</h1>
        <label className="mb-4 flex flex-col gap-1 text-sm text-slate-600">
          Share this link:
          <input
            data-testid="waiting-room-link"
            readOnly
            value={gameShareLink(gameId)}
            onFocus={(e) => e.currentTarget.select()}
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <ul data-testid="waiting-room-seats" className="flex flex-col gap-2">
          {SEAT_POSITIONS.map((position) => {
            const participant = byPosition.get(position);
            return (
              <li
                key={position}
                data-testid="waiting-room-seat"
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span>Seat {position + 1}</span>
                <span className={participant ? "text-slate-900" : "text-slate-400"}>
                  {participant?.playerName ?? "Waiting for player"}
                </span>
              </li>
            );
          })}
        </ul>
        {spectators.length > 0 && (
          <p data-testid="waiting-room-spectators" className="mt-4 text-xs text-slate-500">
            {pluralize(spectators.length, "spectator")}: {spectators.map((s) => s.playerName).join(", ")}
          </p>
        )}

        {canStart && (
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              data-testid="waiting-room-start-button"
              disabled={isStarting}
              onClick={onStart}
              className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isStarting ? "Starting…" : "Start game"}
            </button>
            {startError && (
              <p data-testid="waiting-room-start-error" className="text-xs text-red-500">
                {startError.message}
              </p>
            )}
          </div>
        )}

        {myPosition === null && (
          <form
            data-testid="waiting-room-join-form"
            className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = playerName.trim();
              if (trimmed) onJoin(trimmed);
            }}
          >
            <label className="flex flex-col gap-1 text-sm text-slate-600">
              Your name
              <input
                data-testid="waiting-room-name-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <button
              type="submit"
              data-testid="waiting-room-join-button"
              disabled={!playerName.trim() || isJoining}
              className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isJoining ? "Joining…" : "Join game"}
            </button>
            {joinError && (
              <p data-testid="waiting-room-join-error" className="text-xs text-red-500">
                {joinError.message}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
