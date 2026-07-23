// hooks/useGameActions.ts — Task 4.3 (IMPLEMENTATION.md). Thin TanStack Query
// wrappers (ARCHITECTURE.md section 1, "HTTP Client: TanStack Query") around
// the mutation routes from Task 3.1/3.2/3.3, so callers get loading/error
// state without hand-rolling fetch + useState per action. playerId/position
// are bound once here rather than passed at each call site, since every
// mutation needs them and the caller (Task 4.4's useGame) already has them.
"use client";

import { useMutation } from "@tanstack/react-query";
import { postJson } from "@/lib/httpClient";
import type {
  CardWithWild,
  ExchangeCardsRequest,
  ExchangeCardsResponse,
  JoinGameResponse,
  PassResponse,
  PlayCardsResponse,
  PlayerPosition,
  StartGameResponse,
} from "@/lib/types";

// PlayCardsResponse/ExchangeCardsResponse can report a rule rejection
// (invalid combo, doesn't beat lead, wrong card to give back, ...) as
// `{success: false, error, reason}` on an HTTP 200 rather than a non-2xx
// status - postJson's res.ok check alone wouldn't catch that, so callers
// would see a silently "successful" mutation. Throwing here routes it
// through the same mutation error state as any other failure.
function throwIfUnsuccessful<TResponse extends { success: boolean }>(
  response: TResponse,
): TResponse & { success: true } {
  if (!response.success) {
    const { error, reason } = response as { error?: string; reason?: string };
    throw new Error(reason ?? error ?? "Request rejected");
  }
  return response as TResponse & { success: true };
}

export interface UseGameActionsOptions {
  gameId: string;
  playerId: string;
  // null while spectating; playCards/pass/exchangeCards require a seat, so
  // those mutations reject locally instead of firing a request the server
  // would reject anyway.
  position: PlayerPosition | null;
}

// Only the fields the caller needs to choose - playerId/position come from
// the bound options above, not the caller.
export type ExchangeCardsInput = Omit<
  ExchangeCardsRequest,
  "playerId" | "position"
>;

export function useGameActions({
  gameId,
  playerId,
  position,
}: UseGameActionsOptions) {
  const playCardsMutation = useMutation({
    mutationFn: (cards: CardWithWild[]) => {
      if (position === null) {
        return Promise.reject(new Error("Must be seated to play cards"));
      }
      return postJson<PlayCardsResponse>(`/api/game/${gameId}/play-cards`, {
        cards,
        playerId,
        position,
      }).then(throwIfUnsuccessful);
    },
  });

  const passMutation = useMutation({
    mutationFn: () => {
      if (position === null) {
        return Promise.reject(new Error("Must be seated to pass"));
      }
      return postJson<PassResponse>(`/api/game/${gameId}/pass`, {
        playerId,
        position,
      });
    },
  });

  const joinGameMutation = useMutation({
    mutationFn: (playerName: string) =>
      postJson<JoinGameResponse>(`/api/game/${gameId}/join`, {
        playerName,
        playerId,
      }),
  });

  // Only a seated player can start (server-enforced, route.ts's "Only a
  // seated player can start the game"), so - like playCards/pass above -
  // this rejects locally for a spectator instead of firing a request the
  // server would reject anyway.
  const startGameMutation = useMutation({
    mutationFn: () => {
      if (position === null) {
        return Promise.reject(new Error("Must be seated to start the game"));
      }
      return postJson<StartGameResponse>(`/api/game/${gameId}/start`, { playerId });
    },
  });

  const exchangeCardsMutation = useMutation({
    mutationFn: (input: ExchangeCardsInput) => {
      if (position === null) {
        return Promise.reject(new Error("Must be seated to exchange cards"));
      }
      return postJson<ExchangeCardsResponse>(
        `/api/game/${gameId}/exchange-cards`,
        { ...input, playerId, position },
      ).then(throwIfUnsuccessful);
    },
  });

  return {
    playCards: playCardsMutation.mutateAsync,
    isPlayingCards: playCardsMutation.isPending,
    playCardsError: playCardsMutation.error,

    pass: passMutation.mutateAsync,
    isPassing: passMutation.isPending,
    passError: passMutation.error,

    joinGame: joinGameMutation.mutateAsync,
    isJoiningGame: joinGameMutation.isPending,
    joinGameError: joinGameMutation.error,

    exchangeCards: exchangeCardsMutation.mutateAsync,
    isExchangingCards: exchangeCardsMutation.isPending,
    exchangeCardsError: exchangeCardsMutation.error,

    startGame: startGameMutation.mutateAsync,
    isStartingGame: startGameMutation.isPending,
    startGameError: startGameMutation.error,
  };
}
