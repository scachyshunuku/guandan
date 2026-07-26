"use client";

import { useState } from "react";
import { useGameContext } from "./GameProvider";
import GameTable from "@/components/game/GameTable";
import PlayerHand from "@/components/game/PlayerHand";
import TrickDisplay from "@/components/game/TrickDisplay";
import ScoreBoard from "@/components/game/ScoreBoard";
import ActionButtons from "@/components/game/ActionButtons";
import CardExchangeModal from "@/components/game/CardExchangeModal";
import TributeChoiceModal from "@/components/game/TributeChoiceModal";
import WildCardSelector from "@/components/game/WildCardSelector";
import { canPlayCards } from "@/lib/gameRules/validation";
import { levelRankForLevels } from "@/lib/cardUtils";
import { gameShareLink, pluralize } from "@/lib/format";
import type {
  Card,
  CardExchangeActionData,
  CardWithWild,
  GameParticipant,
  PlayerPosition,
  StandardRank,
  Suit,
} from "@/lib/types";

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
    roundStatus,
    finishingPositions,
    pendingTributeChoice,
    roundActions,
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
    exchangeCards,
    isExchangingCards,
    exchangeCardsError,
    chooseTribute,
    isChoosingTribute,
    chooseTributeError,
    startGame,
    isStartingGame,
    startGameError,
  } = useGameContext();

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  // Keyed by hand index, one entry per level-rank heart the viewer has
  // already given a wild interpretation to (RULES.md "Level Cards & Wild
  // Cards") - a double deck (ARCHITECTURE.md) means a player can hold and
  // select more than one at once (e.g. two wilds completing a bomb), so this
  // is a map rather than a single value; an eligible card missing from it
  // just hasn't been assigned one yet.
  const [wildActsAsByIndex, setWildActsAsByIndex] = useState<
    Record<number, { rank: StandardRank; suit: Suit }>
  >({});
  // Discards stale wild choices the moment the selection they were made for
  // changes, rather than in a useEffect (React's "adjusting state when a
  // prop changes" pattern - https://react.dev/learn/you-might-not-need-an-effect)
  // - an effect here would let one extra render briefly show a wild
  // interpretation attached to a selection it was never chosen for.
  const [wildActsAsForSelection, setWildActsAsForSelection] = useState(selectedIndices);
  if (wildActsAsForSelection !== selectedIndices) {
    setWildActsAsForSelection(selectedIndices);
    setWildActsAsByIndex({});
  }

  if (isLoading) {
    return (
      <div data-testid="game-loading" className="flex flex-1 items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">Loading game…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="game-error" className="flex flex-1 items-center justify-center bg-slate-100">
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

  const game = { teamALevel: teamLevels[0], teamBLevel: teamLevels[1], winningTeam };
  const round = { currentPlayerTurn, gameState: { currentTrick } };
  const isMyTurn = myPosition !== null && currentPlayerTurn === myPosition;
  const levelRank = levelRankForLevels(teamLevels[0], teamLevels[1]);

  // Every level-rank heart in the current selection (RULES.md "Level Cards &
  // Wild Cards") - a double deck (ARCHITECTURE.md) means more than one can
  // legitimately be selected together (e.g. two wilds completing a bomb).
  const wildEligibleIndices = selectedIndices.filter(
    (index) => hand[index]?.rank === levelRank && hand[index]?.suit === "HEARTS",
  );
  // A level-rank heart can always legally be played as itself (RULES.md: the
  // wild substitution is optional, not mandatory) - e.g. a lone heart is
  // already a valid single on an empty trick without ever opening the
  // selector. The selector only needs to interrupt when the raw selection
  // (played as itself) *isn't* already a legal play, since that's the only
  // case where a wild interpretation could be what makes it one.
  const rawSelectedCards = selectedIndices.map((index) => hand[index]);
  const rawSelectionIsValid = canPlayCards(rawSelectedCards, hand, currentTrick, levelRank).valid;
  // The next eligible card still waiting on a wild interpretation - prompted
  // one at a time rather than all at once, so WildCardSelector's UI (one
  // rank/suit picker) doesn't need to change shape for the multi-wild case.
  const pendingWildIndex = rawSelectionIsValid
    ? undefined
    : wildEligibleIndices.find((index) => wildActsAsByIndex[index] === undefined);
  const needsWildChoice = pendingWildIndex !== undefined;
  // What actually gets validated/submitted: the raw selection, except every
  // wild-eligible card gets its own chosen actsAs attached once assigned.
  const effectiveSelectedCards = selectedIndices.map((index) =>
    wildActsAsByIndex[index] ? { ...hand[index], actsAs: wildActsAsByIndex[index] } : hand[index],
  );

  function handlePlay(cards: CardWithWild[]) {
    setSelectedIndices([]);
    setWildActsAsByIndex({});
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

  function handleSubmitReturn(card: Card) {
    exchangeCards({ cardToGive: card }).catch(() => {
      // Failure surfaces via exchangeCardsError below.
    });
  }

  function handleChooseTribute(take: PlayerPosition) {
    chooseTribute(take).catch(() => {
      // Failure surfaces via chooseTributeError below.
    });
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
          {winningTeam === null
            ? "Game over"
            : myPosition === null
              ? `Game over — Team ${winningTeam === 0 ? "A" : "B"} wins`
              : myPosition % 2 === winningTeam
                ? "Game over — your team wins!"
                : "Game over — your team lost"}
        </p>
      ) : myPosition === null ? (
        <p data-testid="spectator-note" className="text-sm text-slate-500">
          You&apos;re spectating
        </p>
      ) : roundStatus === "card_exchange" ? (
        <CardExchangeModal
          myPosition={myPosition}
          hand={hand}
          initialExchanges={roundActions
            .filter((a) => a.actionType === "card_exchange")
            .map((a) => a.actionData as CardExchangeActionData)
            .filter((d) => d.type === "initial")}
          onSubmitReturn={handleSubmitReturn}
          isSubmitting={isExchangingCards}
        />
      ) : roundStatus === "awaiting_tribute_choice" && pendingTributeChoice ? (
        <TributeChoiceModal
          thirdPosition={pendingTributeChoice.thirdPosition}
          thirdCard={pendingTributeChoice.thirdCard}
          fourthPosition={pendingTributeChoice.fourthPosition}
          fourthCard={pendingTributeChoice.fourthCard}
          isFirstPlace={finishingPositions?.indexOf(1) === myPosition}
          onChoose={handleChooseTribute}
          isSubmitting={isChoosingTribute}
        />
      ) : currentPlayerTurn === null ? (
        <p data-testid="hand-ended-message" className="text-sm text-slate-500">
          Hand ended — resolving…
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <PlayerHand
            hand={hand}
            selectedIndices={selectedIndices}
            onSelectionChange={setSelectedIndices}
          />
          {needsWildChoice && pendingWildIndex !== undefined && (
            // Keyed by which card this prompt is for, so a second wild in
            // the same selection (a double deck can hold two level-rank
            // hearts) gets a fresh selector rather than one still showing
            // the first card's already-picked rank/suit.
            <WildCardSelector
              key={pendingWildIndex}
              onConfirm={(actsAs) =>
                setWildActsAsByIndex((prev) => ({ ...prev, [pendingWildIndex]: actsAs }))
              }
              onCancel={() => setSelectedIndices([])}
            />
          )}
          <ActionButtons
            hand={hand}
            selectedCards={effectiveSelectedCards}
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
      {exchangeCardsError && (
        <p data-testid="exchange-error" className="text-xs text-red-500">
          {exchangeCardsError.message}
        </p>
      )}
      {chooseTributeError && (
        <p data-testid="tribute-choice-error" className="text-xs text-red-500">
          {chooseTributeError.message}
        </p>
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
