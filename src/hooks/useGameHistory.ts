// hooks/useGameHistory.ts — Task 6.3's "game history/replay". Wraps
// GET /api/game/[id]/history (Task 3.4), the complete unredacted action log
// across every round - distinct from GameStateResponse.roundActions, which
// only covers the current round.
"use client";

import { useQuery } from "@tanstack/react-query";
import type { GameActionsResponse } from "@/lib/types";

export interface UseGameHistoryOptions {
  gameId: string;
  // The full log is only worth fetching once a viewer opens the history
  // panel, not on every render of the live board - callers pass whether
  // that panel is currently open.
  enabled: boolean;
}

export function useGameHistory({ gameId, enabled }: UseGameHistoryOptions) {
  const query = useQuery({
    queryKey: ["gameHistory", gameId],
    queryFn: async (): Promise<GameActionsResponse> => {
      const res = await fetch(`/api/game/${gameId}/history`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load history");
      }
      return data as GameActionsResponse;
    },
    enabled,
  });

  return {
    actions: query.data?.actions ?? [],
    isLoading: query.isLoading,
    error: query.error,
    // Broadcasts (Task 4.2) aren't wired into this hook's query - it's a
    // one-off fetch, not a store synced live off the games:[id] channel -
    // so a panel left open during play would otherwise go stale until
    // closed/reopened. Exposed so a caller can refetch on a signal it
    // already has (game/[id]/page.tsx refetches on currentTrick changing).
    refetch: query.refetch,
  };
}
