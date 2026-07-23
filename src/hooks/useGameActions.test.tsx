import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGameActions } from "./useGameActions";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as jest.Mock;
}

describe("useGameActions", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("playCards posts cards, playerId and position to play-cards", async () => {
    mockFetchOnce(200, { success: true });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 2 }),
      { wrapper },
    );

    const cards = [{ suit: "hearts", rank: 5 }] as never;
    await act(async () => {
      await result.current.playCards(cards);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1/play-cards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cards, playerId: "player-1", position: 2 }),
      }),
    );
  });

  it("playCards rejects locally without hitting the network when spectating", async () => {
    global.fetch = jest.fn();
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: null }),
      { wrapper },
    );

    await expect(result.current.playCards([])).rejects.toThrow(
      "Must be seated to play cards",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("pass posts playerId and position to pass", async () => {
    mockFetchOnce(200, { success: true });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 1 }),
      { wrapper },
    );

    await act(async () => {
      await result.current.pass();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1/pass",
      expect.objectContaining({
        body: JSON.stringify({ playerId: "player-1", position: 1 }),
      }),
    );
  });

  it("joinGame posts playerName and playerId to join, even while spectating", async () => {
    mockFetchOnce(201, { spectator: true });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: null }),
      { wrapper },
    );

    let response;
    await act(async () => {
      response = await result.current.joinGame("Alice");
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1/join",
      expect.objectContaining({
        body: JSON.stringify({ playerName: "Alice", playerId: "player-1" }),
      }),
    );
    expect(response).toEqual({ spectator: true });
  });

  it("startGame posts the bound playerId to start", async () => {
    mockFetchOnce(200, { success: true, hand: [] });
    const { result } = renderHook(
      () => useGameActions({ gameId: "game-1", playerId: "player-1", position: 2 }),
      { wrapper },
    );

    let response;
    await act(async () => {
      response = await result.current.startGame();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ playerId: "player-1" }),
      }),
    );
    expect(response).toEqual({ success: true, hand: [] });
  });

  it("startGame rejects locally without hitting the network when spectating", async () => {
    global.fetch = jest.fn();
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: null }),
      { wrapper },
    );

    await expect(result.current.startGame()).rejects.toThrow(
      "Must be seated to start the game",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("exchangeCards posts cardToGive plus the bound playerId/position", async () => {
    mockFetchOnce(200, { success: true });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 0 }),
      { wrapper },
    );

    const cardToGive = { suit: "spades", rank: 3 } as never;
    await act(async () => {
      await result.current.exchangeCards({
        cardToGive,
        type: "return",
        recipientPosition: 3,
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/game/game-1/exchange-cards",
      expect.objectContaining({
        body: JSON.stringify({
          cardToGive,
          type: "return",
          recipientPosition: 3,
          playerId: "player-1",
          position: 0,
        }),
      }),
    );
  });

  it("surfaces a server error message and sets the mutation error state", async () => {
    mockFetchOnce(400, { error: "Not your turn" });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 2 }),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.playCards([])).rejects.toThrow(
        "Not your turn",
      );
    });

    await waitFor(() => expect(result.current.playCardsError).not.toBeNull());
    expect(result.current.playCardsError?.message).toBe("Not your turn");
    expect(result.current.isPlayingCards).toBe(false);
  });

  it("treats an HTTP 200 with success:false as a rejection, not a silent success", async () => {
    mockFetchOnce(200, {
      success: false,
      error: "Invalid combination",
      reason: "Cards do not form a valid play",
    });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 2 }),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.playCards([])).rejects.toThrow(
        "Cards do not form a valid play",
      );
    });

    await waitFor(() => expect(result.current.playCardsError).not.toBeNull());
    expect(result.current.playCardsError?.message).toBe(
      "Cards do not form a valid play",
    );
  });

  it("exchangeCards also treats success:false as a rejection", async () => {
    mockFetchOnce(200, {
      success: false,
      error: "Invalid exchange",
      reason: "You don't hold that card",
    });
    const { result } = renderHook(
      () =>
        useGameActions({ gameId: "game-1", playerId: "player-1", position: 0 }),
      { wrapper },
    );

    await act(async () => {
      await expect(
        result.current.exchangeCards({
          cardToGive: { suit: "spades", rank: 3 } as never,
          type: "return",
          recipientPosition: 3,
        }),
      ).rejects.toThrow("You don't hold that card");
    });

    await waitFor(() =>
      expect(result.current.exchangeCardsError).not.toBeNull(),
    );
    expect(result.current.exchangeCardsError?.message).toBe(
      "You don't hold that card",
    );
  });
});
