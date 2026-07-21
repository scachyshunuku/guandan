import { renderHook } from "@testing-library/react";
import { useGameRealtimeSync } from "./useGameRealtimeSync";
import { useGameStore } from "@/store/gameStore";
import type { GameAction } from "@/lib/types";

// Minimal fake of the chainable supabase-js Realtime channel API
// (`.channel().on().on().on().subscribe()`), just enough to drive the
// broadcast handlers this hook registers and assert on subscribe/
// unsubscribe calls.
type Handler = (message: { payload: unknown }) => void;

class FakeChannel {
  handlers: { event: string; handler: Handler }[] = [];
  on(type: string, filter: { event: string }, handler: Handler) {
    if (type !== "broadcast") {
      throw new Error(`expected only "broadcast" subscriptions, got "${type}"`);
    }
    this.handlers.push({ event: filter.event, handler });
    return this;
  }
  subscribe() {
    return this;
  }
  fire(event: string, payload: unknown) {
    const entry = this.handlers.find((h) => h.event === event);
    if (!entry) throw new Error(`no handler registered for broadcast event "${event}"`);
    entry.handler({ payload });
  }
}

const channels: FakeChannel[] = [];
const removeChannel = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: {
    channel: jest.fn((name: string) => {
      const channel = new FakeChannel();
      (channel as unknown as { name: string }).name = name;
      channels.push(channel);
      return channel;
    }),
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  },
}));

describe("useGameRealtimeSync", () => {
  beforeEach(() => {
    channels.length = 0;
    removeChannel.mockClear();
    useGameStore.getState().reset();
  });

  it("does not subscribe when gameId is null", () => {
    renderHook(() => useGameRealtimeSync(null));
    expect(channels).toHaveLength(0);
  });

  it("subscribes to the games:[gameId] channel", () => {
    renderHook(() => useGameRealtimeSync("game-1"));
    expect(channels).toHaveLength(1);
    expect((channels[0] as unknown as { name: string }).name).toBe("games:game-1");
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useGameRealtimeSync("game-1"));
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
  });

  it("re-subscribes to a new channel when gameId changes", () => {
    const { rerender } = renderHook(({ gameId }) => useGameRealtimeSync(gameId), {
      initialProps: { gameId: "game-1" },
    });
    rerender({ gameId: "game-2" });

    expect(channels).toHaveLength(2);
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
    expect((channels[1] as unknown as { name: string }).name).toBe("games:game-2");
  });

  it("syncs game_updated broadcasts to gameStatus and teamLevels", () => {
    renderHook(() => useGameRealtimeSync("game-1"));

    channels[0].fire("game_updated", {
      id: "game-1",
      status: "in_progress",
      team_a_level: 5,
      team_b_level: 3,
      winning_team: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const state = useGameStore.getState();
    expect(state.gameStatus).toBe("in_progress");
    expect(state.teamLevels).toEqual([5, 3]);
  });

  it("syncs round_updated broadcasts to currentTrick and currentPlayerTurn", () => {
    renderHook(() => useGameRealtimeSync("game-1"));

    channels[0].fire("round_updated", {
      id: "round-1",
      game_id: "game-1",
      round_number: 1,
      game_state: { currentTrick: [[{ suit: "HEARTS", rank: "5" }], "PASS"], trickCount: 0 },
      current_player_turn: 2,
      leader_position: 0,
      status: "in_progress",
      finishing_positions: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const state = useGameStore.getState();
    expect(state.currentTrick).toEqual([[{ suit: "HEARTS", rank: "5" }], "PASS"]);
    expect(state.currentPlayerTurn).toBe(2);
  });

  it("syncs participant_joined broadcasts by appending to participants", () => {
    renderHook(() => useGameRealtimeSync("game-1"));

    channels[0].fire("participant_joined", {
      id: "participant-1",
      game_id: "game-1",
      player_name: "Alice",
      player_id: "alice",
      position: 0,
      hand: [],
      is_connected: true,
      connected_at: "2026-01-01T00:00:00.000Z",
      last_heartbeat: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const state = useGameStore.getState();
    expect(state.participants).toEqual([
      expect.objectContaining({ id: "participant-1", playerName: "Alice", position: 0 }),
    ]);
  });

  it("relays game_action broadcasts to onGameAction", () => {
    const onGameAction = jest.fn();
    renderHook(() => useGameRealtimeSync("game-1", onGameAction));

    const actionRow = {
      id: "action-1",
      game_id: "game-1",
      round_id: "round-1",
      player_id: "player-1",
      action_type: "pass",
      action_data: {},
      created_at: "2026-01-01T00:00:00.000Z",
    };
    channels[0].fire("game_action", actionRow);

    const expected: GameAction = {
      id: "action-1",
      gameId: "game-1",
      roundId: "round-1",
      playerId: "player-1",
      actionType: "pass",
      actionData: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(onGameAction).toHaveBeenCalledWith(expected);
  });

  it("calls the latest onGameAction callback without re-subscribing", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ cb }) => useGameRealtimeSync("game-1", cb),
      { initialProps: { cb: first } },
    );
    rerender({ cb: second });

    expect(channels).toHaveLength(1);

    channels[0].fire("game_action", {
      id: "action-1",
      game_id: "game-1",
      round_id: "round-1",
      player_id: "player-1",
      action_type: "pass",
      action_data: {},
      created_at: "2026-01-01T00:00:00.000Z",
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});
