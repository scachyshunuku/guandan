import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGameHistory } from "./useGameHistory";
import type { GameAction } from "@/lib/types";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

const ACTION: GameAction = {
  id: "action-1",
  gameId: "game-1",
  roundId: "round-1",
  playerId: "player-1",
  actionType: "pass",
  actionData: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("useGameHistory", () => {
  afterEach(() => jest.clearAllMocks());

  it("does not fetch while disabled", () => {
    global.fetch = jest.fn();
    renderHook(() => useGameHistory({ gameId: "game-1", enabled: false }), { wrapper });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches the action log once enabled", async () => {
    mockFetchOnce(200, { actions: [ACTION] });
    const { result } = renderHook(
      () => useGameHistory({ gameId: "game-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.actions).toEqual([ACTION]));
    expect(global.fetch).toHaveBeenCalledWith("/api/game/game-1/history");
  });

  it("surfaces a fetch error", async () => {
    mockFetchOnce(500, { error: "Boom" });
    const { result } = renderHook(
      () => useGameHistory({ gameId: "game-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("Boom");
  });

  it("refetches on demand, e.g. so a caller can pick up new actions while a panel is open", async () => {
    mockFetchOnce(200, { actions: [ACTION] });
    const { result } = renderHook(
      () => useGameHistory({ gameId: "game-1", enabled: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.actions).toEqual([ACTION]));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const secondAction = { ...ACTION, id: "action-2" };
    mockFetchOnce(200, { actions: [ACTION, secondAction] });
    await result.current.refetch();

    await waitFor(() => expect(result.current.actions).toEqual([ACTION, secondAction]));
  });
});
