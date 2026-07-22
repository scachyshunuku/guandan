// Subscribes to the `games:[gameId]` Realtime channel and syncs updates into
// the Zustand store (IMPLEMENTATION.md Task 4.2). See ARCHITECTURE.md
// section 10 for the channel/event contract this implements and section 6
// for the store shape this feeds.
//
// Everything arrives via `broadcast`, not `postgres_changes` — this app
// doesn't assume `games`/`game_rounds`/`game_actions`/`game_participants`
// have been added to the `supabase_realtime` publication (a manual,
// per-project setup step), so API routes explicitly call
// `lib/realtimeBroadcast.ts` after each write instead. There's no store
// field for raw actions, so `game_action` events are handed to the caller
// via `onGameAction` rather than synced directly.
//
// No `participant_left` event yet — there's no `leave` route (or
// disconnect/heartbeat detection) in the codebase at all; that's
// IMPLEMENTATION.md Task 6.2 ("Player disconnects/reconnects"), still
// blocked on Phase 3-5. `participant_joined` only covers the join half.
import { useEffect, useRef } from "react";
import type { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useGameStore } from "@/store/gameStore";
import {
  mapGameActionRow,
  mapGameParticipantRow,
  mapGameRoundRow,
  mapGameRow,
  type GameActionRow,
  type GameParticipantRow,
  type GameRoundRow,
  type GameRow,
} from "@/lib/db/mappers";
import type { GameAction } from "@/lib/types";

export function useGameRealtimeSync(
  gameId: string | null,
  onGameAction?: (action: GameAction) => void,
  // Surfaces the channel's subscribe status (SUBSCRIBED/CHANNEL_ERROR/
  // TIMED_OUT/CLOSED) so callers (Task 4.4's useGame) can tell a dropped
  // connection from a healthy one - broadcasts are missed while down, since
  // there's no replay, only a resubscribe.
  onStatusChange?: (status: REALTIME_SUBSCRIBE_STATES) => void,
) {
  const onGameActionRef = useRef(onGameAction);
  useEffect(() => {
    onGameActionRef.current = onGameAction;
  }, [onGameAction]);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!gameId) return;

    const channel = supabase
      .channel(`games:${gameId}`)
      .on("broadcast", { event: "game_updated" }, ({ payload }: { payload: GameRow }) => {
        const game = mapGameRow(payload);
        useGameStore.getState().setGameStatus(game.status);
        useGameStore.getState().setTeamLevels(game.teamALevel, game.teamBLevel);
      })
      .on("broadcast", { event: "round_updated" }, ({ payload }: { payload: GameRoundRow }) => {
        const round = mapGameRoundRow(payload);
        useGameStore.getState().updateTrick(round.gameState.currentTrick);
        useGameStore.getState().setCurrentPlayerTurn(round.currentPlayerTurn);
      })
      .on(
        "broadcast",
        { event: "participant_joined" },
        ({ payload }: { payload: GameParticipantRow }) => {
          useGameStore.getState().addParticipant(mapGameParticipantRow(payload));
        },
      )
      .on("broadcast", { event: "game_action" }, ({ payload }: { payload: GameActionRow }) => {
        onGameActionRef.current?.(mapGameActionRow(payload));
      })
      .subscribe((status) => onStatusChangeRef.current?.(status));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);
}
