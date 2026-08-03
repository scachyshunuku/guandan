"use client";

import { useEffect, useRef, useState } from "react";
import { useGameContext } from "./GameProvider";
import { useGameHistory } from "@/hooks/useGameHistory";
import type { ConnectionStatus as ConnectionStatusValue } from "@/hooks/useGame";
import GameTable from "@/components/game/GameTable";
import PlayerHand, {
  remapCardIndices,
  startHandPanelMarquee,
  type PlayerHandHandle,
} from "@/components/game/PlayerHand";
import ScoreBoard from "@/components/game/ScoreBoard";
import ActionButtons from "@/components/game/ActionButtons";
import CardExchangeModal from "@/components/game/CardExchangeModal";
import ConnectionStatus from "@/components/game/ConnectionStatus";
import SpectatorList from "@/components/game/SpectatorList";
import GameHistory from "@/components/game/GameHistory";
import TributeChoiceModal from "@/components/game/TributeChoiceModal";
import WildCardSelector from "@/components/game/WildCardSelector";
import { bestCardCandidates } from "@/lib/gameRules/cardExchange";
import { encodeCard, levelRankForLevels } from "@/lib/cardUtils";
import { gameShareLink } from "@/lib/format";
import { filterSpectators } from "@/store/gameStore";
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
// built in Tasks 5.1-5.4 (PlayerHand, GameTable, ScoreBoard, ActionButtons)
// around the single useGame() subscription GameProvider (Task 4.4) hands
// down via context. "Handle game state" means switching on gameStatus - the
// round doesn't exist yet while 'waiting' (GameStateResponse doc comment in
// lib/types.ts), so the board only renders once play starts.
export default function GamePage() {
  const {
    gameId,
    gameStatus,
    participants,
    myPosition,
    hand,
    myHandOrder,
    updateHandOrder,
    currentTrick,
    currentPlayerTurn,
    roundStatus,
    finishingPositions,
    pendingTributeChoice,
    pendingGiverChoice,
    roundActions,
    teamLevels,
    winningTeam,
    connectionStatus,
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
    chooseGiverCard,
    isChoosingGiverCard,
    chooseGiverCardError,
    startGame,
    isStartingGame,
    startGameError,
    addBot,
    isAddingBot,
    addBotError,
  } = useGameContext();

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const playerHandRef = useRef<PlayerHandHandle>(null);
  // Extends marquee box-select's hit area beyond PlayerHand's own tightly-
  // wrapped bounds to the whole cards+action-buttons panel below, matching
  // what visually reads as "the hand panel" - a press directly on a card or
  // any button is excluded (those already have their own behavior), and so
  // is any press that landed inside PlayerHand's own root: it already starts
  // a marquee itself for a press on its own empty background (target ===
  // its own currentTarget), so without this a press there would register
  // the gesture twice - once here, once inside PlayerHand - each running its
  // own independent set of window move/up listeners.
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
  const [wildActsAsForSelection, setWildActsAsForSelection] =
    useState(selectedIndices);

  // Selection is exposed as hand indices for the existing ActionButtons API,
  // but realtime updates can remove a card before the next render (for
  // example, after a successful play). Remap selected cards by identity so a
  // removed card cannot make the next card appear selected, and clear wild
  // interpretations because their index keys are no longer trustworthy.
  const handSignature = hand.map((card) => encodeCard(card)).join(",");
  const [previousHand, setPreviousHand] = useState(hand);
  const [previousHandSignature, setPreviousHandSignature] = useState(handSignature);
  if (previousHandSignature !== handSignature) {
    const remapped = remapCardIndices(previousHand, hand, selectedIndices);
    setPreviousHand(hand);
    setPreviousHandSignature(handSignature);
    if (remapped.some((index, i) => index !== selectedIndices[i]) || remapped.length !== selectedIndices.length) {
      setSelectedIndices(remapped);
    }
    setWildActsAsByIndex({});
    setWildActsAsForSelection(remapped);
  }
  if (wildActsAsForSelection !== selectedIndices) {
    setWildActsAsForSelection(selectedIndices);
    setWildActsAsByIndex({});
  }

  // The history panel is always visible (not a toggle) once the game has
  // started - only gated on gameStatus so the waiting room, which has no
  // history to show yet, doesn't fire this fetch.
  const history = useGameHistory({ gameId, enabled: gameStatus !== "waiting" });
  // useGameHistory's query is a one-off fetch, not synced live off the
  // games:[id] channel (unlike currentTrick/hand/etc.) - without this, the
  // always-visible panel would silently go stale as new actions land.
  // currentTrick changing is a proxy for "a new action landed."
  useEffect(() => {
    if (gameStatus !== "waiting") history.refetch();
    // Deliberately depends on history.refetch (react-query's stable
    // function reference), not the whole `history` object, which is a
    // fresh object literal every render (useGameHistory.ts) and would
    // defeat this effect's point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrick, gameStatus, history.refetch]);

  if (isLoading) {
    return (
      <div
        data-testid="game-loading"
        className="flex flex-1 items-center justify-center bg-slate-100"
      >
        <p className="text-sm text-slate-500">Loading game…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="game-error"
        className="flex flex-1 items-center justify-center bg-slate-100"
      >
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

    // Seats one bot per still-open seat, sequentially - add-bot/route.ts
    // handles one seat per call, so "fill the rest with bots" is this
    // loop's job, not the route's. No refetch needed afterward: each
    // add-bot call's own join broadcasts participant_joined (and its own
    // is_bot flip broadcasts participant_updated), which every connected
    // client - including this one - already syncs into `participants` live,
    // the same way another human joining updates this screen without this
    // client doing anything.
    function handleFillWithBots() {
      const openSeats = 4 - participants.filter((p) => p.position !== null).length;
      (async () => {
        for (let i = 0; i < openSeats; i++) {
          await addBot();
        }
      })().catch(() => {
        // Failure surfaces via addBotError below.
      });
    }

    return (
      <WaitingRoom
        gameId={gameId}
        participants={participants}
        myPosition={myPosition}
        connectionStatus={connectionStatus}
        onJoin={handleJoin}
        isJoining={isJoiningGame}
        joinError={joinGameError}
        onStart={handleStart}
        isStarting={isStartingGame}
        startError={startGameError}
        onFillWithBots={handleFillWithBots}
        isAddingBot={isAddingBot}
        addBotError={addBotError}
      />
    );
  }

  const game = {
    teamALevel: teamLevels[0],
    teamBLevel: teamLevels[1],
    winningTeam,
  };
  const round = { currentPlayerTurn, gameState: { currentTrick } };
  const isMyTurn = myPosition !== null && currentPlayerTurn === myPosition;
  const levelRank = levelRankForLevels(teamLevels[0], teamLevels[1]);
  const isAwaitingGiverChoice = roundStatus === "awaiting_giver_choice" && pendingGiverChoice != null;
  const isGivingTribute =
    roundStatus === "awaiting_giver_choice" &&
    myPosition !== null &&
    pendingGiverChoice?.pendingPositions.includes(myPosition) === true;
  // The player still sees their complete hand while choosing tribute, but
  // only one of these tied best eligible cards may be given. The server
  // recomputes and enforces this same candidate set on submission.
  const tributeCandidates = isGivingTribute && pendingGiverChoice
    ? bestCardCandidates(hand, pendingGiverChoice.levelRank)
    : [];
  const selectedTributeCard =
    isGivingTribute && selectedIndices.length === 1 ? hand[selectedIndices[0]] : undefined;
  const canGiveTribute =
    selectedTributeCard !== undefined &&
    tributeCandidates.some((candidate) => encodeCard(candidate) === encodeCard(selectedTributeCard));

  // Every level-rank heart in the current selection (RULES.md "Level Cards &
  // Wild Cards") - a double deck (ARCHITECTURE.md) means more than one can
  // legitimately be selected together (e.g. two wilds completing a bomb).
  const wildEligibleIndices = (isGivingTribute ? [] : selectedIndices).filter(
    (index) =>
      hand[index]?.rank === levelRank && hand[index]?.suit === "HEARTS",
  );
  // The selector always opens for a level-rank heart, even when playing it as
  // itself would already be legal - the player decides the interpretation
  // rather than it being silently inferred, since only they know whether they
  // meant it as the wild or its literal rank. WildCardSelector offers a
  // one-click "play as itself" shortcut for that literal case.
  // The next eligible card still waiting on a wild interpretation - prompted
  // one at a time rather than all at once, so WildCardSelector's UI (one
  // rank/suit picker) doesn't need to change shape for the multi-wild case.
  const pendingWildIndex = wildEligibleIndices.find(
    (index) => wildActsAsByIndex[index] === undefined,
  );
  const needsWildChoice = pendingWildIndex !== undefined;
  // What actually gets validated/submitted: the raw selection, except every
  // wild-eligible card gets its own chosen actsAs attached once assigned.
  const effectiveSelectedCards = selectedIndices.flatMap((index) => {
    const card = hand[index];
    if (!card) return [];
    return [
      wildActsAsByIndex[index]
        ? { ...card, actsAs: wildActsAsByIndex[index] }
        : card,
    ];
  });

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

  function handleGiveTribute() {
    if (!selectedTributeCard || !canGiveTribute) return;
    setSelectedIndices([]);
    chooseGiverCard(selectedTributeCard).catch(() => {
      // Failure surfaces via chooseGiverCardError below.
    });
  }

  const spectators = filterSpectators(participants);

  return (
    <div
      data-testid="game-page-layout"
      className="flex flex-1 flex-col items-center gap-4 bg-slate-100 px-2 py-4 sm:gap-6 sm:px-4 sm:py-8"
    >
      <ConnectionStatus status={connectionStatus} />
      <ScoreBoard game={game} />

      {/* Grid (not flex) so the cards-panel row below can col-span-full to
          exactly the width of main + aside - a fixed lg:grid-cols-[36rem_20rem]
          (matching main's old lg:max-w-xl and aside's old lg:w-80) gives the
          grid an intrinsic width for lg:w-fit to shrink to, which flex's
          content-based sizing can't do for a spanning row. */}
      <div className="grid w-full grid-cols-1 gap-4 sm:gap-6 lg:w-fit lg:grid-cols-[36rem_20rem]">
        <main
          data-testid="game-page"
          className="flex flex-col items-center gap-4 sm:gap-6"
        >
          <GameTable
            round={round}
            participants={participants}
            myPosition={myPosition}
          />
          <SpectatorList spectators={spectators} />

          {gameStatus === "completed" ? (
            <p
              data-testid="game-over-message"
              className="text-sm font-semibold text-slate-700"
            >
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
              participants={participants}
              initialExchanges={roundActions
                .filter((a) => a.actionType === "card_exchange")
                .map((a) => a.actionData as CardExchangeActionData)
                .filter((d) => d.type === "initial")}
              onSubmitReturn={handleSubmitReturn}
              isSubmitting={isExchangingCards}
            />
          ) : roundStatus === "awaiting_giver_choice" && pendingGiverChoice ? (
            !isGivingTribute ? (
              <p
                data-testid="giver-choice-waiting"
                className="text-sm text-slate-500"
              >
                Waiting for position{" "}
                {pendingGiverChoice.pendingPositions.join(", ")} to choose which
                card to give…
              </p>
            ) : null
          ) : roundStatus === "awaiting_tribute_choice" &&
            pendingTributeChoice ? (
            <TributeChoiceModal
              thirdPosition={pendingTributeChoice.thirdPosition}
              thirdCard={pendingTributeChoice.thirdCard}
              fourthPosition={pendingTributeChoice.fourthPosition}
              fourthCard={pendingTributeChoice.fourthCard}
              participants={participants}
              isFirstPlace={finishingPositions?.indexOf(1) === myPosition}
              onChoose={handleChooseTribute}
              isSubmitting={isChoosingTribute}
            />
          ) : currentPlayerTurn === null ? (
            <p
              data-testid="hand-ended-message"
              className="text-sm text-slate-500"
            >
              Hand ended — resolving…
            </p>
          ) : null}
          {exchangeCardsError && (
            <p data-testid="exchange-error" className="text-xs text-red-500">
              {exchangeCardsError.message}
            </p>
          )}
          {chooseTributeError && (
            <p
              data-testid="tribute-choice-error"
              className="text-xs text-red-500"
            >
              {chooseTributeError.message}
            </p>
          )}
          {chooseGiverCardError && (
            <p
              data-testid="giver-choice-error"
              className="text-xs text-red-500"
            >
              {chooseGiverCardError.message}
            </p>
          )}
        </main>

        {/* order-3 lg:order-2 puts this panel below the cards on mobile
            (where the grid collapses to one column and items stack by
            order), while keeping it beside main in its usual second column
            at lg - see the col-span-full div below, which is order-2
            lg:order-3 to match.

            lg:relative + the child's lg:absolute lg:inset-x-0 lg:top-0 is
            what pins this panel's height to main's without measuring
            anything in JS: an absolutely positioned box doesn't count
            toward its container's content height, so once the child drops
            out of flow at lg, this aside has no in-flow content of its own
            left to size itself by - main (the grid's other, still in-flow
            item) becomes the row's only height driver, and the grid's
            default align-items:stretch (no lg:items-start override on the
            row above) stretches this aside to that height. The child then
            gets that exact height back via top-0/inset-x-0 against aside's
            now-definite box, and can scroll its own (potentially very long)
            content inside it without growing the row further. lg:bottom-4
            (rather than closing the loop with inset-0) leaves a strip of
            aside's own white background permanently uncovered below the
            scrollable child, so there's always a gap under the last entry
            even mid-scroll - closing it with inset-0 would only reserve
            that gap once the list happened to be scrolled to its true end.
            Below lg, main and aside stack into separate rows instead of
            sharing one, so there's no row height to match against - the
            child instead falls back to its own max-h-80/overflow-y-auto so
            a long history still scrolls internally there rather than
            growing the page without bound. */}
        <aside
          data-testid="game-history-panel"
          className="order-3 w-full rounded-2xl bg-white shadow-sm lg:relative lg:order-2"
        >
          <div className="max-h-80 overflow-y-auto px-4 pb-4 lg:max-h-none lg:absolute lg:inset-x-0 lg:top-0 lg:bottom-4">
            {/* pt-4/pb-2 live on the heading itself (not the scrolling div
                above) so they travel with it once sticky pins it in place -
                otherwise the container's own top padding scrolls away like
                any other content, and whatever entry ends up underneath is
                left uncovered (no opaque box there to hide it) rather than
                tucked behind a solid heading. Sticky (not just lg:sticky)
                since the div above now scrolls internally below lg too. */}
            <h2 className="sticky top-0 z-10 border-b border-slate-200 bg-white pt-4 pb-2 text-sm font-semibold text-slate-900">
              History
            </h2>
            <GameHistory
              actions={history.actions}
              participants={participants}
              isLoading={history.isLoading}
              error={history.error}
            />
          </div>
        </aside>

        {/* Spans both grid columns - the hand's card grid uses the space
            under the history panel too instead of wrapping into a narrow
            column, but stays capped to main + aside's combined width rather
            than the full screen (mirrors the last branch of the status
            ternary above, which renders null in this exact case).
            order-2 lg:order-3 (paired with the aside's order-3 lg:order-2
            above) is what puts the cards above history on mobile but below
            it at lg, matching this row's normal DOM position there. */}
        {gameStatus !== "completed" &&
          myPosition !== null &&
          roundStatus !== "card_exchange" &&
          (!isAwaitingGiverChoice || isGivingTribute) &&
          !(
            roundStatus === "awaiting_tribute_choice" && pendingTributeChoice
          ) &&
          (currentPlayerTurn !== null || isGivingTribute) && (
            <div
              className="col-span-full order-2 flex w-full flex-col items-start gap-3 lg:order-3"
              onPointerDown={(event) => startHandPanelMarquee(event, playerHandRef)}
            >
              <PlayerHand
                ref={playerHandRef}
                hand={hand}
                selectedIndices={selectedIndices}
                onSelectionChange={setSelectedIndices}
                persistenceKey={`${gameId}:${myPosition}`}
                initialServerOrder={myHandOrder}
                onOrderChange={updateHandOrder}
              />
              {isGivingTribute ? (
                <div data-testid="tribute-give-controls" className="flex flex-col items-start gap-2">
                  <p data-testid="tribute-give-instruction" className="text-sm text-slate-700">
                    Choose one of your highest eligible cards to give as tribute. Level hearts are exempt.
                  </p>
                  <button
                    type="button"
                    data-testid="give-tribute-button"
                    disabled={!canGiveTribute || isChoosingGiverCard}
                    onClick={handleGiveTribute}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    Give
                  </button>
                  {selectedIndices.length > 0 && !canGiveTribute && (
                    <p data-testid="tribute-give-invalid-reason" className="text-xs text-red-500">
                      Select exactly one card tied for your highest eligible rank.
                    </p>
                  )}
                </div>
              ) : needsWildChoice && pendingWildIndex !== undefined && (
                // Keyed by which card this prompt is for, so a second wild in
                // the same selection (a double deck can hold two level-rank
                // hearts) gets a fresh selector rather than one still showing
                // the first card's already-picked rank/suit.
                <WildCardSelector
                  key={pendingWildIndex}
                  card={{ rank: levelRank, suit: "HEARTS" }}
                  onConfirm={(actsAs) =>
                    setWildActsAsByIndex((prev) => ({
                      ...prev,
                      [pendingWildIndex]: actsAs,
                    }))
                  }
                  onCancel={() => setSelectedIndices([])}
                />
              )}
              {!isGivingTribute && <ActionButtons
                hand={hand}
                selectedCards={effectiveSelectedCards}
                currentTrick={currentTrick}
                levelRank={levelRank}
                isMyTurn={isMyTurn}
                onPlay={handlePlay}
                onPass={handlePass}
                hasPendingWildChoice={needsWildChoice}
                isSubmitting={isPlayingCards || isPassing}
              />}
              {!isGivingTribute && (playCardsError ?? passError) && (
                <p
                  data-testid="action-error"
                  className="text-xs text-red-500"
                >
                  {(playCardsError ?? passError)?.message}
                </p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

const SEAT_POSITIONS = [0, 1, 2, 3] as const;

function WaitingRoom({
  gameId,
  participants,
  myPosition,
  connectionStatus,
  onJoin,
  isJoining,
  joinError,
  onStart,
  isStarting,
  startError,
  onFillWithBots,
  isAddingBot,
  addBotError,
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
  connectionStatus: ConnectionStatusValue;
  onJoin: (playerName: string) => void;
  isJoining: boolean;
  joinError: Error | null;
  onStart: () => void;
  isStarting: boolean;
  startError: Error | null;
  onFillWithBots: () => void;
  isAddingBot: boolean;
  addBotError: Error | null;
}) {
  const [playerName, setPlayerName] = useState("");
  const byPosition = new Map(
    participants.filter((p) => p.position !== null).map((p) => [p.position, p]),
  );
  const spectators = filterSpectators(participants);
  // Only a seated player can start (route.ts's "Only a seated player can
  // start the game"), and only once all 4 seats are filled (its "Need 4
  // players to start") - pre-checked here so the button never fires a
  // doomed request, same as ActionButtons does for play/pass.
  const canStart = myPosition !== null && byPosition.size === 4;
  // Same seated-player requirement as starting (add-bot/route.ts's "Only a
  // seated player can add a bot"); unlike starting, this is offered *before*
  // all 4 seats are full - its whole point is filling the rest.
  const canAddBots = myPosition !== null && byPosition.size < 4;

  return (
    <main
      data-testid="waiting-room"
      className="flex flex-1 flex-col items-center gap-6 bg-slate-100 px-2 py-8 sm:px-4 sm:py-16"
    >
      <ConnectionStatus status={connectionStatus} />
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold text-slate-900">
          Waiting for players…
        </h1>
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
                <span
                  className={participant ? "text-slate-900" : "text-slate-400"}
                >
                  {participant?.playerName ?? "Waiting for player"}
                </span>
              </li>
            );
          })}
        </ul>
        {spectators.length > 0 && (
          <div className="mt-4">
            <SpectatorList spectators={spectators} />
          </div>
        )}

        {canAddBots && (
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              data-testid="waiting-room-fill-with-bots-button"
              disabled={isAddingBot}
              onClick={onFillWithBots}
              className="self-start rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isAddingBot ? "Adding bots…" : "Fill remaining seats with bots"}
            </button>
            {addBotError && (
              <p
                data-testid="waiting-room-add-bot-error"
                className="text-xs text-red-500"
              >
                {addBotError.message}
              </p>
            )}
          </div>
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
              <p
                data-testid="waiting-room-start-error"
                className="text-xs text-red-500"
              >
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
              <p
                data-testid="waiting-room-join-error"
                className="text-xs text-red-500"
              >
                {joinError.message}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
