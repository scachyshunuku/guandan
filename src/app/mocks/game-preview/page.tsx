"use client";

// Interactive, DB-free rendering of the game page's layout (ScoreBoard + GameTable
// + history panel) using fixed fixtures from src/mocks/gameFixtures.ts, so CSS
// changes to that layout - like the history panel's height being pinned to
// the game table's - can be eyeballed at /mocks/game-preview without going
// through the real create-game/join/fill-with-bots/start flow. Select a card
// below and Play to simulate a realtime broadcast; no API request is made.

import { useRef, useState } from "react";
import GameTable from "@/components/game/GameTable";
import PlayerHand, {
  startHandPanelMarquee,
  type PlayerHandHandle,
} from "@/components/game/PlayerHand";
import ActionButtons from "@/components/game/ActionButtons";
import ScoreBoard from "@/components/game/ScoreBoard";
import SpectatorList from "@/components/game/SpectatorList";
import GameHistory from "@/components/game/GameHistory";
import { levelRankForLevels } from "@/lib/cardUtils";
import type { CardWithWild, CurrentTrick, PlayerPosition } from "@/lib/types";
import { filterSpectators } from "@/store/gameStore";
import {
  mockActions,
  mockGame,
  mockHand,
  mockInteractiveTrick,
  mockParticipants,
} from "@/mocks/gameFixtures";

export default function GamePreviewPage() {
  const [hand, setHand] = useState<CardWithWild[]>(mockHand);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [currentTrick, setCurrentTrick] = useState<CurrentTrick>(mockInteractiveTrick);
  const [currentPlayerTurn, setCurrentPlayerTurn] = useState<PlayerPosition | null>(0);
  const [participants, setParticipants] = useState(mockParticipants);
  const [broadcastMessage, setBroadcastMessage] = useState(
    "Select a card below to simulate a play broadcast.",
  );
  const playerHandRef = useRef<PlayerHandHandle>(null);

  const spectators = filterSpectators(participants);
  const round = {
    currentPlayerTurn,
    gameState: { currentTrick },
  };
  const levelRank = levelRankForLevels(mockGame.teamALevel, mockGame.teamBLevel);

  function handlePlay(cards: CardWithWild[]) {
    const playedIndices = new Set(selectedIndices);
    const remainingHand = hand.filter((_, index) => !playedIndices.has(index));

    // This is the mock equivalent of the realtime response: update the board
    // and hand together as if the server broadcast the accepted play.
    setHand(remainingHand);
    setCurrentTrick((previous) => [
      ...previous,
      { position: 0, play: cards },
    ]);
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.position === 0
          ? { ...participant, handCount: remainingHand.length }
          : participant,
      ),
    );
    setSelectedIndices([]);
    setCurrentPlayerTurn(1);
    setBroadcastMessage(
      `Broadcast received · Alice played ${cards.length === 2 ? "a pair" : "cards"}`,
    );
  }

  function handlePass() {
    setCurrentTrick((previous) => [...previous, { position: 0, play: "PASS" }]);
    setSelectedIndices([]);
    setCurrentPlayerTurn(1);
    setBroadcastMessage("Broadcast received · Alice passed");
  }

  return (
    <div
      data-testid="game-page-layout"
      className="flex flex-1 flex-col items-center gap-4 bg-slate-100 px-2 py-4 sm:gap-6 sm:px-4 sm:py-8"
    >
      <ScoreBoard game={mockGame} />

      <div className="grid w-full grid-cols-1 gap-4 sm:gap-6 lg:w-fit lg:grid-cols-[36rem_20rem]">
        <main
          data-testid="game-page"
          className="flex flex-col items-center gap-4 sm:gap-6"
        >
          <GameTable round={round} participants={participants} myPosition={0} />
          <SpectatorList spectators={spectators} />
        </main>

        <aside
          data-testid="game-history-panel"
          className="w-full rounded-2xl bg-white shadow-sm lg:relative"
        >
          <div className="p-4 lg:absolute lg:inset-0 lg:overflow-y-auto">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">History</h2>
            <GameHistory
              actions={mockActions}
              participants={mockParticipants}
              isLoading={false}
              error={null}
            />
          </div>
        </aside>

        <div
          data-testid="mock-player-area"
          className="col-span-full flex w-full flex-col items-start gap-3 rounded-2xl bg-white p-4 shadow-sm"
          onPointerDown={(event) => startHandPanelMarquee(event, playerHandRef)}
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Your hand</h2>
            <p data-testid="mock-broadcast-status" className="text-xs text-slate-500">
              {broadcastMessage}
            </p>
          </div>
          <PlayerHand
            ref={playerHandRef}
            hand={hand}
            selectedIndices={selectedIndices}
            onSelectionChange={setSelectedIndices}
          />
          <ActionButtons
            hand={hand}
            selectedCards={selectedIndices.flatMap((index) => {
              const selectedCard = hand[index];
              return selectedCard ? [selectedCard] : [];
            })}
            currentTrick={currentTrick}
            levelRank={levelRank}
            isMyTurn={currentPlayerTurn === 0}
            onPlay={handlePlay}
            onPass={handlePass}
          />
        </div>
      </div>
    </div>
  );
}
