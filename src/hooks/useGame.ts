// hooks/useGame.ts — Task 4.4 (IMPLEMENTATION.md). The single hook a game
// screen (Task 5.x) wires up: hydrates the Zustand store from
// `GET /api/game/[id]` on mount, layers Task 4.2's realtime sync on top for
// live updates, and wraps Task 4.3's mutations with optimistic updates so
// the UI reacts instantly instead of waiting on a round trip.
//
// "Reconnection" (per the checklist) means resyncing after a dropped
// realtime connection: broadcasts have no replay, so anything missed while
// the channel was down (CHANNEL_ERROR/TIMED_OUT/CLOSED) would otherwise
// leave the store stale forever. Re-fetching full state on the next
// SUBSCRIBED closes that gap - the same GET the initial mount uses (see its
// doc comment: "used to hydrate... on initial load & reconnect").
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useGameStore } from "@/store/gameStore";
import { useGameRealtimeSync } from "./useGameRealtimeSync";
import { useGameActions, type ExchangeCardsInput } from "./useGameActions";
import { encodeCard } from "@/lib/cardUtils";
import { PASS } from "@/lib/types";
import type {
  CardExchangeActionData,
  CardWithWild,
  GameAction,
  GameStateResponse,
} from "@/lib/types";

export interface UseGameOptions {
  gameId: string;
  playerId: string;
}

// Removes one hand entry per card in `cards` (matched by suit/rank, not
// object identity - the store's copy and the caller's copy of a card are
// different objects), one at a time, so removing e.g. a single "5H" out of a
// hand holding two doesn't remove both.
function removeCardsFromHand(
  hand: CardWithWild[],
  cards: CardWithWild[],
): CardWithWild[] {
  const remaining = [...hand];
  for (const card of cards) {
    const code = encodeCard(card);
    const index = remaining.findIndex((c) => encodeCard(c) === code);
    if (index !== -1) remaining.splice(index, 1);
  }
  return remaining;
}

// Applies an optimistic store update and rolls it back if `mutate` rejects.
// `apply` returns its own revert closure so each caller decides exactly
// what "this optimistic value is still current" means for the fields it
// touched - a revert only takes effect for a field if nothing else (e.g. a
// round_updated/game_action broadcast landing while the request was in
// flight) already replaced it with something newer, so a slow-to-fail
// request can't stomp over authoritative state that has since arrived.
async function withOptimisticUpdate<T>(
  apply: () => () => void,
  mutate: () => Promise<T>,
): Promise<T> {
  const revert = apply();
  try {
    return await mutate();
  } catch (err) {
    revert();
    throw err;
  }
}

function applyGameState(response: GameStateResponse, gameId: string, playerId: string) {
  const store = useGameStore.getState();
  store.setGame(gameId, playerId);
  store.setGameStatus(response.game.status);
  store.setTeamLevels(response.game.teamALevel, response.game.teamBLevel);
  store.setWinningTeam(response.game.winningTeam);
  store.updateParticipants(response.participants);
  const me = response.participants.find((p) => p.playerId === playerId);
  store.setMyPosition(me?.position ?? null);
  store.setHand(response.myHand);
  if (response.round) {
    store.updateTrick(response.round.gameState.currentTrick);
    store.setCurrentPlayerTurn(response.round.currentPlayerTurn);
  }
}

export function useGame({ gameId, playerId }: UseGameOptions) {
  const gameStatus = useGameStore((s) => s.gameStatus);
  const participants = useGameStore((s) => s.participants);
  const myPosition = useGameStore((s) => s.myPosition);
  const hand = useGameStore((s) => s.hand);
  const currentTrick = useGameStore((s) => s.currentTrick);
  const currentPlayerTurn = useGameStore((s) => s.currentPlayerTurn);
  const teamLevels = useGameStore((s) => s.teamLevels);
  const winningTeam = useGameStore((s) => s.winningTeam);

  const actions = useGameActions({ gameId, playerId, position: myPosition });
  // useGameActions/useQuery return a fresh object every render, so a plain
  // `[actions]`/`[gameStateQuery]` dependency would defeat the memoization
  // below. Mirrors the ref pattern useGameRealtimeSync already uses for its
  // own callback props.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  // TanStack Query owns the fetch's own loading/error state (react-query's
  // internals, not a local useState set from inside an effect - matches
  // Task 4.3's useGameActions and sidesteps react-hooks/set-state-in-effect).
  // Hydrating the *store* from the result is a separate effect below that
  // only touches Zustand, which the same rule doesn't apply to.
  const gameStateQuery = useQuery({
    queryKey: ["game", gameId, playerId],
    queryFn: async (): Promise<GameStateResponse> => {
      const res = await fetch(
        `/api/game/${gameId}?playerId=${encodeURIComponent(playerId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load game");
      }
      return data as GameStateResponse;
    },
  });
  const gameStateQueryRef = useRef(gameStateQuery);
  useEffect(() => {
    gameStateQueryRef.current = gameStateQuery;
  }, [gameStateQuery]);

  // Broadcasts aren't replayed, so anything missed while disconnected has to
  // be recovered with a fresh fetch once the channel comes back.
  const wasDisconnectedRef = useRef(false);

  // The realtime channel subscribes independent of the hydration query, so a
  // card_exchange broadcast addressed to me could in principle arrive before
  // `myPosition` is set - onGameAction's `data.to !== myPosition` check would
  // then always miss it (myPosition still null), silently dropping a card
  // with no replay to recover it. Queuing anything that arrives before
  // hydration completes and replaying it right after `applyGameState` runs
  // closes that gap.
  const hasHydratedRef = useRef(false);
  const pendingActionsRef = useRef<GameAction[]>([]);

  // A stale game left over in the store from a previous gameId (e.g.
  // navigating from one game straight to another) would otherwise bleed
  // into this one until the query above resolves. Also drops a stale
  // "disconnected" flag from the previous game's channel, which otherwise
  // would trigger a pointless (if harmless) refetch on this game's first
  // SUBSCRIBED.
  useEffect(() => {
    const state = useGameStore.getState();
    if (state.gameId !== null && state.gameId !== gameId) {
      state.reset();
    }
    wasDisconnectedRef.current = false;
    hasHydratedRef.current = false;
    pendingActionsRef.current = [];
  }, [gameId]);

  const handleGameAction = useCallback((action: GameAction) => {
    // The only game_action type that can change *my* hand without me having
    // initiated it - hands never travel on game_updated/round_updated/
    // participant_joined (ARCHITECTURE.md section 10), so this is the sole
    // way a received exchange card reaches the store.
    if (action.actionType !== "card_exchange") return;
    const data = action.actionData as CardExchangeActionData;
    if (data.to !== useGameStore.getState().myPosition) return;
    const store = useGameStore.getState();
    store.setHand([...store.hand, data.card]);
  }, []);

  useEffect(() => {
    if (!gameStateQuery.data) return;
    applyGameState(gameStateQuery.data, gameId, playerId);
    hasHydratedRef.current = true;
    const pending = pendingActionsRef.current;
    pendingActionsRef.current = [];
    pending.forEach(handleGameAction);
  }, [gameStateQuery.data, gameId, playerId, handleGameAction]);

  const onGameAction = useCallback(
    (action: GameAction) => {
      if (!hasHydratedRef.current) {
        pendingActionsRef.current.push(action);
        return;
      }
      handleGameAction(action);
    },
    [handleGameAction],
  );

  const onStatusChange = useCallback((status: REALTIME_SUBSCRIBE_STATES) => {
    if (status === "SUBSCRIBED") {
      if (wasDisconnectedRef.current) {
        wasDisconnectedRef.current = false;
        gameStateQueryRef.current.refetch();
      }
      return;
    }
    wasDisconnectedRef.current = true;
  }, []);

  useGameRealtimeSync(gameId, onGameAction, onStatusChange);

  const playCards = useCallback(
    (cards: CardWithWild[]) =>
      withOptimisticUpdate(() => {
        const previousHand = useGameStore.getState().hand;
        const previousTrick = useGameStore.getState().currentTrick;
        const position = useGameStore.getState().myPosition;

        const optimisticHand = removeCardsFromHand(previousHand, cards);
        useGameStore.getState().setHand(optimisticHand);

        const optimisticTrick =
          position === null
            ? previousTrick
            : [...previousTrick, { position, play: cards }];
        if (position !== null) {
          useGameStore.getState().updateTrick(optimisticTrick);
        }

        return () => {
          if (useGameStore.getState().hand === optimisticHand) {
            useGameStore.getState().setHand(previousHand);
          }
          if (useGameStore.getState().currentTrick === optimisticTrick) {
            useGameStore.getState().updateTrick(previousTrick);
          }
        };
      }, () => actionsRef.current.playCards(cards)),
    [],
  );

  const pass = useCallback(
    () =>
      withOptimisticUpdate(() => {
        const previousTrick = useGameStore.getState().currentTrick;
        const position = useGameStore.getState().myPosition;

        const optimisticTrick =
          position === null
            ? previousTrick
            : [...previousTrick, { position, play: PASS }];
        if (position !== null) {
          useGameStore.getState().updateTrick(optimisticTrick);
        }

        return () => {
          if (useGameStore.getState().currentTrick === optimisticTrick) {
            useGameStore.getState().updateTrick(previousTrick);
          }
        };
      }, () => actionsRef.current.pass()),
    [],
  );

  const exchangeCards = useCallback(
    (input: ExchangeCardsInput) =>
      withOptimisticUpdate(() => {
        const previousHand = useGameStore.getState().hand;
        const optimisticHand = removeCardsFromHand(previousHand, [input.cardToGive]);
        useGameStore.getState().setHand(optimisticHand);

        return () => {
          if (useGameStore.getState().hand === optimisticHand) {
            useGameStore.getState().setHand(previousHand);
          }
        };
      }, () => actionsRef.current.exchangeCards(input)),
    [],
  );

  // Not optimistic like the mutations above - there's nothing to guess at
  // locally (the dealt hand is server-random), so this just applies the
  // response once it's confirmed. gameStatus/currentPlayerTurn update
  // separately via the game_updated/round_updated broadcasts every
  // subscribed client (including this one) receives - see
  // realtimeBroadcast.ts's doc comment - only the caller's own hand needs
  // this explicit round-trip, since hands are deliberately never broadcast.
  const startGame = useCallback(async () => {
    const response = await actionsRef.current.startGame();
    useGameStore.getState().setHand(response.hand);
    return response;
  }, []);

  return {
    gameStatus,
    participants,
    myPosition,
    hand,
    currentTrick,
    currentPlayerTurn,
    teamLevels,
    winningTeam,

    isLoading: gameStateQuery.isLoading,
    error: gameStateQuery.error,
    refetch: gameStateQuery.refetch,

    playCards,
    isPlayingCards: actions.isPlayingCards,
    playCardsError: actions.playCardsError,

    pass,
    isPassing: actions.isPassing,
    passError: actions.passError,

    joinGame: actions.joinGame,
    isJoiningGame: actions.isJoiningGame,
    joinGameError: actions.joinGameError,

    exchangeCards,
    isExchangingCards: actions.isExchangingCards,
    exchangeCardsError: actions.exchangeCardsError,

    startGame,
    isStartingGame: actions.isStartingGame,
    startGameError: actions.startGameError,
  };
}
