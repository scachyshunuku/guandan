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
// No `participant_left` event — there's still no `leave` route. There is
// now a `participant_updated` event (IMPLEMENTATION.md Task 6.2, "Player
// disconnects/reconnects"): the heartbeat route broadcasts it whenever a
// participant's connected status changes (their own heartbeat lands, or
// they're swept as stale by someone else's), reusing `addParticipant`'s
// upsert-by-id the same way `participant_joined` does.
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
import type { GameAction, GameRound } from "@/lib/types";

export function useGameRealtimeSync(
  gameId: string | null,
  onGameAction?: (action: GameAction) => void,
  // Fires with every round_updated payload, before it's applied to the
  // store - lets callers (Task 4.4's useGame) compare against the store's
  // *previous* round id/status to detect a freshly-dealt hand (hands are
  // deliberately never broadcast; see useGame.ts's onRoundUpdate).
  onRoundUpdate?: (round: GameRound) => void,
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

  const onRoundUpdateRef = useRef(onRoundUpdate);
  useEffect(() => {
    onRoundUpdateRef.current = onRoundUpdate;
  }, [onRoundUpdate]);

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
        onRoundUpdateRef.current?.(round);
        useGameStore.getState().applyRoundUpdate(round);
      })
      .on(
        "broadcast",
        { event: "participant_joined" },
        ({ payload }: { payload: GameParticipantRow }) => {
          useGameStore.getState().addParticipant(mapGameParticipantRow(payload));
        },
      )
      .on(
        "broadcast",
        { event: "participant_updated" },
        ({ payload }: { payload: GameParticipantRow }) => {
          useGameStore.getState().addParticipant(mapGameParticipantRow(payload));
        },
      )
      .on("broadcast", { event: "game_action" }, ({ payload }: { payload: GameActionRow }) => {
        const action = mapGameActionRow(payload);
        // A round_updated broadcast for the same transition (a fresh deal,
        // or a tribute resolving into 'card_exchange') can trigger
        // useGame.ts's onRoundUpdate to refetch full state - including this
        // same action, via roundActions - before this broadcast is
        // delivered. Without this guard, a card_exchange action arriving
        // after that refetch would double-apply: appendRoundAction would
        // duplicate the entry in roundActions (CardExchangeModal would show
        // the same exchange twice), and onGameActionRef's handleGameAction
        // would append the transferred card to `hand` a second time even
        // though the refetch's `myHand` already included it. Both writes
        // share this one gate rather than each guarding itself, since
        // there's nothing to apply from an action the store already has.
        if (useGameStore.getState().roundActions.some((a) => a.id === action.id)) return;
        useGameStore.getState().appendRoundAction(action);
        onGameActionRef.current?.(action);
      })
      .subscribe((status) => onStatusChangeRef.current?.(status));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);
}
