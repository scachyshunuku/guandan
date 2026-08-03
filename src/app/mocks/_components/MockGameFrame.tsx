"use client";

// Shared page chrome for every /mocks preview (ScoreBoard, GameTable,
// spectator list, history panel) - Task-driven previews only ever differ in
// what's shown in the "your hand" panel at the bottom, so factoring that out
// here means every scenario (live play, each card-exchange branch) renders
// against the same realistic surroundings instead of a bare component on a
// blank page. That makes them directly comparable to each other and to the
// real game page's layout, not just individually plausible.

import type { PointerEvent, ReactNode } from "react";
import GameTable, { type GameTableProps } from "@/components/game/GameTable";
import ScoreBoard from "@/components/game/ScoreBoard";
import SpectatorList from "@/components/game/SpectatorList";
import GameHistory from "@/components/game/GameHistory";
import type { GameParticipant, PlayerPosition } from "@/lib/types";
import { filterSpectators } from "@/store/gameStore";
import { mockActions, mockGame, mockParticipants } from "@/mocks/gameFixtures";

export interface MockGameFrameProps {
  round: GameTableProps["round"];
  participants?: GameParticipant[];
  myPosition: PlayerPosition | null;
  // Only the live-play preview needs this (extends PlayerHand's marquee
  // box-select hit area to the whole panel); other scenarios simply omit it.
  onHandPanelPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  // The "your hand" panel's full contents - heading, hand, and whatever
  // controls go with it - owned entirely by the caller so each scenario can
  // look exactly like its real-game counterpart.
  children: ReactNode;
  // Floats fixed, centered, above the hand panel instead of sitting inside
  // it - for scenarios like the tied-tribute choice, where the modal needs
  // to sit over a still-visible, still-draggable hand rather than replacing
  // it.
  overlay?: ReactNode;
}

export default function MockGameFrame({
  round,
  participants = mockParticipants,
  myPosition,
  onHandPanelPointerDown,
  children,
  overlay,
}: MockGameFrameProps) {
  const spectators = filterSpectators(participants);

  return (
    <div
      data-testid="game-page-layout"
      className="flex flex-1 flex-col items-center gap-4 bg-slate-100 px-2 py-4 sm:gap-6 sm:px-4 sm:py-8"
    >
      <ScoreBoard game={mockGame} />

      {overlay && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-md">{overlay}</div>
        </div>
      )}

      <div className="grid w-full grid-cols-1 gap-4 sm:gap-6 lg:w-fit lg:grid-cols-[36rem_20rem]">
        <main
          data-testid="game-page"
          className="flex flex-col items-center gap-4 sm:gap-6"
        >
          <GameTable round={round} participants={participants} myPosition={myPosition} />
          <SpectatorList spectators={spectators} />
        </main>

        <aside
          data-testid="game-history-panel"
          className="w-full rounded-2xl bg-white shadow-sm lg:relative"
        >
          <div className="px-4 pb-4 lg:absolute lg:inset-x-0 lg:top-0 lg:bottom-4 lg:overflow-y-auto">
            <h2 className="border-b border-slate-200 bg-white pt-4 pb-2 text-sm font-semibold text-slate-900 lg:sticky lg:top-0 lg:z-10">
              History
            </h2>
            <GameHistory
              actions={mockActions}
              participants={participants}
              isLoading={false}
              error={null}
            />
          </div>
        </aside>

        <div
          data-testid="mock-player-area"
          className="col-span-full flex w-full flex-col items-start gap-3 rounded-2xl bg-white p-4 shadow-sm"
          onPointerDown={onHandPanelPointerDown}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
