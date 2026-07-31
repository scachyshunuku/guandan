import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGame } from "./useGame";
import { useGameStore } from "@/store/gameStore";
import type { CurrentTrick, Game, GameAction, GameRound, GameStateResponse } from "@/lib/types";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// useGame's own job is composition: hydrate on mount, wrap mutations with
// optimistic updates, resync on reconnect. The mechanics of the realtime
// subscription and the mutations themselves are already covered by
// useGameRealtimeSync.test.ts and useGameActions.test.tsx, so those two are
// mocked here and driven directly instead of re-tested through a real
// channel/fetch.
const realtimeSyncCalls: {
  gameId: string | null;
  onGameAction?: (action: GameAction) => void;
  onRoundUpdate?: (round: GameRound) => void;
  onGameUpdate?: (game: Game) => void;
  onStatusChange?: (status: string) => void;
}[] = [];

jest.mock("./useGameRealtimeSync", () => ({
  useGameRealtimeSync: (
    gameId: string | null,
    onGameAction?: (action: GameAction) => void,
    onRoundUpdate?: (round: GameRound) => void,
    onGameUpdate?: (game: Game) => void,
    onStatusChange?: (status: string) => void,
  ) => {
    realtimeSyncCalls.push({ gameId, onGameAction, onRoundUpdate, onGameUpdate, onStatusChange });
  },
}));

const mutationMocks = {
  playCards: jest.fn().mockResolvedValue({ success: true }),
  pass: jest.fn().mockResolvedValue({ success: true }),
  joinGame: jest.fn().mockResolvedValue({ spectator: true }),
  exchangeCards: jest.fn().mockResolvedValue({ success: true }),
  endHand: jest.fn().mockResolvedValue({ success: true }),
  chooseTribute: jest.fn().mockResolvedValue({ success: true }),
  sendHeartbeat: jest.fn().mockResolvedValue({ success: true }),
  updateHandOrder: jest.fn().mockResolvedValue({ success: true }),
  startGame: jest.fn().mockResolvedValue({ success: true, hand: [] }),
};

jest.mock("./useGameActions", () => ({
  useGameActions: () => ({
    playCards: mutationMocks.playCards,
    isPlayingCards: false,
    playCardsError: null,
    pass: mutationMocks.pass,
    isPassing: false,
    passError: null,
    joinGame: mutationMocks.joinGame,
    isJoiningGame: false,
    joinGameError: null,
    exchangeCards: mutationMocks.exchangeCards,
    isExchangingCards: false,
    exchangeCardsError: null,
    endHand: mutationMocks.endHand,
    isEndingHand: false,
    endHandError: null,
    chooseTribute: mutationMocks.chooseTribute,
    isChoosingTribute: false,
    chooseTributeError: null,
    sendHeartbeat: mutationMocks.sendHeartbeat,
    updateHandOrder: mutationMocks.updateHandOrder,
    isUpdatingHandOrder: false,
    updateHandOrderError: null,
    startGame: mutationMocks.startGame,
    isStartingGame: false,
    startGameError: null,
  }),
}));

function gameStateResponse(
  overrides: Partial<GameStateResponse> = {},
): GameStateResponse {
  return {
    game: {
      id: "game-1",
      status: "in_progress",
      teamALevel: 2,
      teamBLevel: 2,
      winningTeam: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    round: {
      id: "round-1",
      gameId: "game-1",
      roundNumber: 1,
      gameState: { currentTrick: [], trickCount: 0, finishOrder: [] },
      currentPlayerTurn: 0,
      leaderPosition: 0,
      status: "in_progress",
      finishingPositions: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    participants: [
      {
        id: "participant-1",
        gameId: "game-1",
        playerName: "Alice",
        playerId: "player-1",
        position: 0,
        hand: [{ rank: "5", suit: "HEARTS" }],
        handCount: 1,
        handOrder: null,
        isConnected: true,
        connectedAt: "2026-01-01T00:00:00.000Z",
        lastHeartbeat: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    myHand: [{ rank: "5", suit: "HEARTS" }],
    myHandOrder: null,
    roundActions: [],
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as jest.Mock;
}

describe("useGame", () => {
  beforeEach(() => {
    realtimeSyncCalls.length = 0;
    Object.values(mutationMocks).forEach((mock) => mock.mockClear());
    useGameStore.getState().reset();
  });

  it("hydrates the store from GET /api/game/[id] on mount", async () => {
    mockFetchOnce(200, gameStateResponse());

    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1?playerId=player-1",
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.myPosition).toBe(0);
    expect(result.current.hand).toEqual([{ rank: "5", suit: "HEARTS" }]);
    expect(result.current.currentPlayerTurn).toBe(0);
    expect(result.current.winningTeam).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("hydrates winningTeam once the game is won", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        game: {
          id: "game-1",
          status: "completed",
          teamALevel: 14,
          teamBLevel: 5,
          winningTeam: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );

    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.winningTeam).toBe(0);
  });

  it("surfaces a failed initial fetch as an error", async () => {
    mockFetchOnce(404, { error: "Game not found" });

    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe("Game not found");
  });

  it("optimistically removes played cards from the hand and adds a trick entry", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let playPromiseResolve!: (value: unknown) => void;
    mutationMocks.playCards.mockReturnValue(
      new Promise((resolve) => {
        playPromiseResolve = resolve;
      }),
    );

    const cardToPlay = [{ rank: "5", suit: "HEARTS" }] as const;
    act(() => {
      result.current.playCards([...cardToPlay]);
    });

    expect(result.current.hand).toEqual([]);
    expect(result.current.currentTrick).toEqual([
      { position: 0, play: [...cardToPlay] },
    ]);

    await act(async () => {
      playPromiseResolve({ success: true });
    });
  });

  it("reverts the optimistic hand/trick update when playCards fails", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mutationMocks.playCards.mockRejectedValue(new Error("Not your turn"));

    await act(async () => {
      await expect(
        result.current.playCards([{ rank: "5", suit: "HEARTS" }]),
      ).rejects.toThrow("Not your turn");
    });

    expect(result.current.hand).toEqual([{ rank: "5", suit: "HEARTS" }]);
    expect(result.current.currentTrick).toEqual([]);
  });

  it("reverts the optimistic trick entry when pass fails", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mutationMocks.pass.mockRejectedValue(new Error("Not your turn"));

    await act(async () => {
      await expect(result.current.pass()).rejects.toThrow("Not your turn");
    });

    expect(result.current.currentTrick).toEqual([]);
  });

  it("optimistically removes the given card from the hand on exchangeCards", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let exchangePromiseResolve!: (value: unknown) => void;
    mutationMocks.exchangeCards.mockReturnValue(
      new Promise((resolve) => {
        exchangePromiseResolve = resolve;
      }),
    );

    act(() => {
      result.current.exchangeCards({
        cardToGive: { rank: "5", suit: "HEARTS" },
      });
    });

    expect(result.current.hand).toEqual([]);
    expect(mutationMocks.exchangeCards).toHaveBeenCalledWith({
      cardToGive: { rank: "5", suit: "HEARTS" },
    });

    await act(async () => {
      exchangePromiseResolve({ success: true });
    });
  });

  it("reverts the optimistic hand update when exchangeCards fails", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mutationMocks.exchangeCards.mockRejectedValue(new Error("You don't hold that card"));

    await act(async () => {
      await expect(
        result.current.exchangeCards({
          cardToGive: { rank: "5", suit: "HEARTS" },
        }),
      ).rejects.toThrow("You don't hold that card");
    });

    expect(result.current.hand).toEqual([{ rank: "5", suit: "HEARTS" }]);
  });

  it("applies the dealt hand once startGame resolves", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const dealtHand = [{ rank: "ACE", suit: "SPADES" }];
    mutationMocks.startGame.mockResolvedValue({ success: true, hand: dealtHand });

    await act(async () => {
      await result.current.startGame();
    });

    expect(result.current.hand).toEqual(dealtHand);
  });

  it("does not clobber a newer broadcast-derived trick when a stale playCards request later fails", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let playPromiseReject!: (err: Error) => void;
    mutationMocks.playCards.mockReturnValue(
      new Promise((_resolve, reject) => {
        playPromiseReject = reject;
      }),
    );

    let playCardsPromise!: Promise<unknown>;
    act(() => {
      playCardsPromise = result.current.playCards([
        { rank: "5", suit: "HEARTS" },
      ]);
    });
    expect(result.current.currentTrick).toEqual([
      { position: 0, play: [{ rank: "5", suit: "HEARTS" }] },
    ]);

    // Simulates what useGameRealtimeSync's round_updated handler does:
    // a broadcast lands - e.g. another player's action was confirmed first
    // - and wholesale-replaces currentTrick with newer authoritative state
    // while our own request is still in flight.
    const broadcastTrick: CurrentTrick = [
      { position: 0, play: [{ rank: "5", suit: "HEARTS" }] },
      { position: 1, play: "PASS" },
    ];
    act(() => {
      useGameStore.getState().updateTrick(broadcastTrick);
    });

    await act(async () => {
      playPromiseReject(new Error("Not your turn"));
      await expect(playCardsPromise).rejects.toThrow("Not your turn");
    });

    expect(result.current.currentTrick).toEqual(broadcastTrick);
  });

  it("queues a card_exchange broadcast that arrives before hydration finishes, then applies it once hydrated", async () => {
    let resolveFetch!: (value: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    ) as jest.Mock;

    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    // The realtime channel can subscribe and deliver a broadcast before the
    // initial GET resolves - myPosition isn't in the store yet at this point.
    const onGameAction = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameAction!;
    act(() => {
      onGameAction({
        id: "action-1",
        gameId: "game-1",
        roundId: "round-1",
        playerId: "player-2",
        actionType: "card_exchange",
        actionData: {
          from: 2,
          to: 0,
          card: { rank: "ACE", suit: "SPADES" },
          type: "initial",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });
    expect(result.current.hand).toEqual([]);

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve(gameStateResponse()),
      });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hand).toEqual([
      { rank: "5", suit: "HEARTS" },
      { rank: "ACE", suit: "SPADES" },
    ]);
  });

  it("appends a received exchange card to the hand via game_action", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const onGameAction = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameAction!;
    act(() => {
      onGameAction({
        id: "action-1",
        gameId: "game-1",
        roundId: "round-1",
        playerId: "player-2",
        actionType: "card_exchange",
        actionData: {
          from: 2,
          to: 0,
          card: { rank: "ACE", suit: "SPADES" },
          type: "initial",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(result.current.hand).toEqual([
      { rank: "5", suit: "HEARTS" },
      { rank: "ACE", suit: "SPADES" },
    ]);
  });

  it("ignores game_action broadcasts not addressed to me", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const onGameAction = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameAction!;
    act(() => {
      onGameAction({
        id: "action-1",
        gameId: "game-1",
        roundId: "round-1",
        playerId: "player-2",
        actionType: "card_exchange",
        actionData: {
          from: 0,
          to: 2,
          card: { rank: "ACE", suit: "SPADES" },
          type: "initial",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(result.current.hand).toEqual([{ rank: "5", suit: "HEARTS" }]);
  });

  it("decrements the player's handCount by the number of cards played", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        participants: [
          {
            id: "participant-1",
            gameId: "game-1",
            playerName: "Alice",
            playerId: "player-1",
            position: 0,
            hand: [{ rank: "5", suit: "HEARTS" }],
            handCount: 1,
            handOrder: null,
            isConnected: true,
            connectedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeat: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "participant-2",
            gameId: "game-1",
            playerName: "Bob",
            playerId: "player-2",
            position: 2,
            hand: [],
            handCount: 27,
            handOrder: null,
            isConnected: true,
            connectedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeat: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const onGameAction = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameAction!;
    act(() => {
      onGameAction({
        id: "action-1",
        gameId: "game-1",
        roundId: "round-1",
        playerId: "player-2",
        actionType: "card_played",
        actionData: {
          position: 2,
          cards: [
            { rank: "3", suit: "HEARTS" },
            { rank: "3", suit: "SPADES" },
          ],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const bob = result.current.participants.find((p) => p.id === "participant-2");
    expect(bob?.handCount).toBe(25);
  });

  it("adjusts both participants' handCounts by 1 for a card_exchange action", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        participants: [
          {
            id: "participant-1",
            gameId: "game-1",
            playerName: "Alice",
            playerId: "player-1",
            position: 0,
            hand: [{ rank: "5", suit: "HEARTS" }],
            handCount: 1,
            handOrder: null,
            isConnected: true,
            connectedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeat: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "participant-3",
            gameId: "game-1",
            playerName: "Carol",
            playerId: "player-3",
            position: 3,
            hand: [],
            handCount: 5,
            handOrder: null,
            isConnected: true,
            connectedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeat: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const onGameAction = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameAction!;
    act(() => {
      onGameAction({
        id: "action-1",
        gameId: "game-1",
        roundId: "round-1",
        playerId: "player-3",
        actionType: "card_exchange",
        actionData: {
          from: 3,
          to: 0,
          card: { rank: "ACE", suit: "SPADES" },
          type: "return",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const alice = result.current.participants.find((p) => p.id === "participant-1");
    const carol = result.current.participants.find((p) => p.id === "participant-3");
    expect(alice?.handCount).toBe(2);
    expect(carol?.handCount).toBe(4);
  });

  it("refetches game state after the channel reconnects following an error", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onStatusChange =
      realtimeSyncCalls[realtimeSyncCalls.length - 1].onStatusChange!;

    act(() => {
      onStatusChange("CHANNEL_ERROR");
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    mockFetchOnce(
      200,
      gameStateResponse({
        game: { ...gameStateResponse().game, teamALevel: 5 },
      }),
    );
    await act(async () => {
      onStatusChange("SUBSCRIBED");
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.teamLevels).toEqual([5, 2]));
  });

  it("does not refetch on the initial SUBSCRIBED transition", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onStatusChange =
      realtimeSyncCalls[realtimeSyncCalls.length - 1].onStatusChange!;
    act(() => {
      onStatusChange("SUBSCRIBED");
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // RULES.md "Card Exchange": the next round's hand is dealt (and, for a
  // resolved tribute, applied) server-side before any round_updated
  // broadcast fires, but hands are deliberately never broadcast — a plain
  // refetch is the only way this client learns its own new hand.
  it("refetches game state when a new round arrives", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onRoundUpdate =
      realtimeSyncCalls[realtimeSyncCalls.length - 1].onRoundUpdate!;

    mockFetchOnce(
      200,
      gameStateResponse({ myHand: [{ rank: "9", suit: "CLUBS" }] }),
    );
    await act(async () => {
      onRoundUpdate({
        id: "round-2",
        gameId: "game-1",
        roundNumber: 2,
        gameState: { currentTrick: [], trickCount: 0, finishOrder: [] },
        currentPlayerTurn: 0,
        leaderPosition: 0,
        status: "in_progress",
        finishingPositions: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hand).toEqual([{ rank: "9", suit: "CLUBS" }]));
  });

  it("refetches game state when this round's tribute resolves into card_exchange", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        round: {
          id: "round-1",
          gameId: "game-1",
          roundNumber: 1,
          gameState: { currentTrick: [], trickCount: 0, finishOrder: [] },
          currentPlayerTurn: null,
          leaderPosition: null,
          status: "awaiting_giver_choice",
          finishingPositions: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onRoundUpdate =
      realtimeSyncCalls[realtimeSyncCalls.length - 1].onRoundUpdate!;

    mockFetchOnce(
      200,
      gameStateResponse({ myHand: [{ rank: "9", suit: "CLUBS" }] }),
    );
    await act(async () => {
      onRoundUpdate({
        id: "round-1",
        gameId: "game-1",
        roundNumber: 1,
        gameState: { currentTrick: [], trickCount: 0, finishOrder: [] },
        currentPlayerTurn: null,
        leaderPosition: null,
        status: "card_exchange",
        finishingPositions: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hand).toEqual([{ rank: "9", suit: "CLUBS" }]));
  });

  it("does not refetch for an ordinary in-round update (e.g. a card played)", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onRoundUpdate =
      realtimeSyncCalls[realtimeSyncCalls.length - 1].onRoundUpdate!;
    act(() => {
      onRoundUpdate({
        id: "round-1",
        gameId: "game-1",
        roundNumber: 1,
        gameState: { currentTrick: [{ position: 1, play: "PASS" }], trickCount: 0, finishOrder: [] },
        currentPlayerTurn: 2,
        leaderPosition: 0,
        status: "in_progress",
        finishingPositions: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches game state when the game flips from waiting to in_progress (start/route.ts's deal)", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        game: {
          id: "game-1",
          status: "waiting",
          teamALevel: 2,
          teamBLevel: 2,
          winningTeam: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        round: null,
        roundActions: [],
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onGameUpdate = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameUpdate!;

    mockFetchOnce(200, gameStateResponse({ myHand: [{ rank: "9", suit: "CLUBS" }] }));
    await act(async () => {
      onGameUpdate({
        id: "game-1",
        status: "in_progress",
        teamALevel: 2,
        teamBLevel: 2,
        winningTeam: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.hand).toEqual([{ rank: "9", suit: "CLUBS" }]));
  });

  it("does not refetch for a game_updated that isn't the waiting-to-in_progress transition", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const onGameUpdate = realtimeSyncCalls[realtimeSyncCalls.length - 1].onGameUpdate!;
    act(() => {
      // Already 'in_progress' in the store (gameStateResponse()'s default) -
      // a level-promotion-only update, not the waiting->in_progress deal.
      onGameUpdate({
        id: "game-1",
        status: "in_progress",
        teamALevel: 5,
        teamBLevel: 2,
        winningTeam: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends a heartbeat immediately on mount", async () => {
    mockFetchOnce(200, gameStateResponse());
    renderHook(() => useGame({ gameId: "game-1", playerId: "player-1" }), { wrapper });

    await waitFor(() => expect(mutationMocks.sendHeartbeat).toHaveBeenCalledTimes(1));
  });

  it("sends heartbeats on an interval well under the stale threshold", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockFetchOnce(200, gameStateResponse());
    renderHook(() => useGame({ gameId: "game-1", playerId: "player-1" }), { wrapper });

    await waitFor(() => expect(mutationMocks.sendHeartbeat).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000 + 1_000);
    });
    expect(mutationMocks.sendHeartbeat.mock.calls.length).toBeGreaterThan(1);

    jest.useRealTimers();
  });

  it("exposes myHandOrder from the hydrated game state", async () => {
    mockFetchOnce(200, gameStateResponse({ myHandOrder: ["7H#0", "3C#0"] }));
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.myHandOrder).toEqual(["7H#0", "3C#0"]));
  });

  it("defaults myHandOrder to null before hydration and when the server has none saved", async () => {
    mockFetchOnce(200, gameStateResponse({ myHandOrder: null }));
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    expect(result.current.myHandOrder).toBeNull();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current.myHandOrder).toBeNull();
  });

  it("updateHandOrder calls through to the underlying mutation", async () => {
    mockFetchOnce(200, gameStateResponse());
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await act(async () => {
      await result.current.updateHandOrder(["7H#0", "3C#0"]);
    });

    expect(mutationMocks.updateHandOrder).toHaveBeenCalledWith(["7H#0", "3C#0"]);
  });

  it("auto-triggers end-hand once a round concludes but the round is still 'in_progress'", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        round: {
          ...gameStateResponse().round!,
          currentPlayerTurn: null,
          status: "in_progress",
        },
      }),
    );
    renderHook(() => useGame({ gameId: "game-1", playerId: "player-1" }), { wrapper });

    await waitFor(() => expect(mutationMocks.endHand).toHaveBeenCalledTimes(1));
  });

  it("retries end-hand on an interval after an outright failure, not just once", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mutationMocks.endHand.mockRejectedValue(new Error("network error"));
    mockFetchOnce(
      200,
      gameStateResponse({
        round: {
          ...gameStateResponse().round!,
          currentPlayerTurn: null,
          status: "in_progress",
        },
      }),
    );
    renderHook(() => useGame({ gameId: "game-1", playerId: "player-1" }), { wrapper });

    await waitFor(() => expect(mutationMocks.endHand).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mutationMocks.endHand.mock.calls.length).toBeGreaterThan(1);

    jest.useRealTimers();
    mutationMocks.endHand.mockResolvedValue({ success: true });
  });

  it("does not auto-trigger end-hand for a spectator", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        participants: [
          {
            id: "participant-1",
            gameId: "game-1",
            playerName: "Alice",
            playerId: "someone-else",
            position: 0,
            hand: [],
            handCount: 0,
            handOrder: null,
            isConnected: true,
            connectedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeat: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        myHand: [],
        round: {
          ...gameStateResponse().round!,
          currentPlayerTurn: null,
          status: "in_progress",
        },
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.myPosition).toBeNull();
    expect(mutationMocks.endHand).not.toHaveBeenCalled();
  });

  it("does not auto-trigger end-hand once the round has moved past 'in_progress'", async () => {
    mockFetchOnce(
      200,
      gameStateResponse({
        round: {
          ...gameStateResponse().round!,
          currentPlayerTurn: null,
          status: "card_exchange",
        },
      }),
    );
    const { result } = renderHook(
      () => useGame({ gameId: "game-1", playerId: "player-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mutationMocks.endHand).not.toHaveBeenCalled();
  });
});
