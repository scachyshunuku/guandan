"use client";

// Static, DB-free rendering of the game page's layout (ScoreBoard + GameTable
// + history panel) using fixed fixtures from src/mocks/gameFixtures.ts, so CSS
// changes to that layout - like the history panel's height being pinned to
// the game table's - can be eyeballed at /mocks/game-preview without going
// through the real create-game/join/fill-with-bots/start flow. Not linked
// from anywhere in the app; dev-only.

import GameTable from "@/components/game/GameTable";
import ScoreBoard from "@/components/game/ScoreBoard";
import SpectatorList from "@/components/game/SpectatorList";
import GameHistory from "@/components/game/GameHistory";
import { filterSpectators } from "@/store/gameStore";
import {
  mockActions,
  mockCurrentTrick,
  mockGame,
  mockParticipants,
} from "@/mocks/gameFixtures";

export default function GamePreviewPage() {
  const spectators = filterSpectators(mockParticipants);
  const round = {
    currentPlayerTurn: 1 as const,
    gameState: { currentTrick: mockCurrentTrick },
  };

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
          <GameTable round={round} participants={mockParticipants} myPosition={0} />
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
      </div>
    </div>
  );
}
