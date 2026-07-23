"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useGame } from "@/hooks/useGame";
import { getOrCreatePlayerId } from "@/lib/playerId";

export type GameContextValue = ReturnType<typeof useGame> & { gameId: string };

const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) {
    throw new Error("useGameContext must be used within GameProvider");
  }
  return value;
}

// Task 5.6's "Game provider": owns the one useGame() call for this route
// segment (Task 4.4) and hands the result to every descendant via context,
// so game/[id]/page.tsx (and any future sibling routes like a spectate
// view) share a single subscription/hydration instead of each mounting
// their own.
export default function GameProvider({
  gameId,
  children,
}: {
  gameId: string;
  children: ReactNode;
}) {
  // getOrCreatePlayerId touches localStorage, which doesn't exist during
  // server rendering. Reading it during render (even guarded by a
  // `typeof window` check) would make the client's first render disagree
  // with the server-rendered HTML it hydrates against, so it's deferred to
  // an effect - the one case React's own docs call out as legitimate
  // "synchronizing with an external system" despite the lint rule's general
  // advice against setState-in-effect.
  const [playerId, setPlayerId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setPlayerId(getOrCreatePlayerId());
  }, []);

  if (playerId === null) {
    return (
      <div data-testid="game-provider-loading" className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <GameProviderInner gameId={gameId} playerId={playerId}>
      {children}
    </GameProviderInner>
  );
}

function GameProviderInner({
  gameId,
  playerId,
  children,
}: {
  gameId: string;
  playerId: string;
  children: ReactNode;
}) {
  const game = useGame({ gameId, playerId });
  return <GameContext.Provider value={{ ...game, gameId }}>{children}</GameContext.Provider>;
}
