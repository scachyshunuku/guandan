import {
  useGameStore,
  getSeatedParticipants,
  getSpectators,
  getMyTeam,
  getTeammatePosition,
  getIsMyTurn,
} from "./gameStore";
import type { GameParticipant, CardWithWild, CurrentTrick } from "@/lib/types";

function makeParticipant(
  overrides: Partial<GameParticipant>,
): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-1",
    position: null,
    hand: [],
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("gameStore", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("starts in the initial waiting state", () => {
    const state = useGameStore.getState();
    expect(state.gameId).toBeNull();
    expect(state.gameStatus).toBe("waiting");
    expect(state.participants).toEqual([]);
    expect(state.myPlayerId).toBeNull();
    expect(state.myPosition).toBeNull();
    expect(state.hand).toEqual([]);
    expect(state.currentTrick).toEqual([]);
    expect(state.currentPlayerTurn).toBeNull();
    expect(state.teamLevels).toEqual([2, 2]);
  });

  it("setGame stores the game id and player id", () => {
    useGameStore.getState().setGame("game-1", "player-1");
    const state = useGameStore.getState();
    expect(state.gameId).toBe("game-1");
    expect(state.myPlayerId).toBe("player-1");
  });

  it("setGameStatus updates status", () => {
    useGameStore.getState().setGameStatus("in_progress");
    expect(useGameStore.getState().gameStatus).toBe("in_progress");
  });

  it("setMyPosition updates position", () => {
    useGameStore.getState().setMyPosition(2);
    expect(useGameStore.getState().myPosition).toBe(2);
  });

  it("setHand replaces the hand", () => {
    const hand: CardWithWild[] = [{ suit: "SPADES", rank: "ACE" }];
    useGameStore.getState().setHand(hand);
    expect(useGameStore.getState().hand).toEqual(hand);
  });

  it("updateTrick replaces the current trick", () => {
    const trick: CurrentTrick = [[{ suit: "HEARTS", rank: "5" }], "PASS"];
    useGameStore.getState().updateTrick(trick);
    expect(useGameStore.getState().currentTrick).toEqual(trick);
  });

  it("setCurrentPlayerTurn updates the turn", () => {
    useGameStore.getState().setCurrentPlayerTurn(3);
    expect(useGameStore.getState().currentPlayerTurn).toBe(3);
  });

  it("updateParticipants replaces the participants list", () => {
    const participants = [
      makeParticipant({ id: "p0", position: 0 }),
      makeParticipant({ id: "p1", position: null }),
    ];
    useGameStore.getState().updateParticipants(participants);
    expect(useGameStore.getState().participants).toEqual(participants);
  });

  it("setTeamLevels updates both team levels", () => {
    useGameStore.getState().setTeamLevels(5, 8);
    expect(useGameStore.getState().teamLevels).toEqual([5, 8]);
  });

  it("reset restores the initial state after mutations", () => {
    const store = useGameStore.getState();
    store.setGame("game-1", "player-1");
    store.setMyPosition(1);
    store.setHand([{ suit: "CLUBS", rank: "3" }]);
    store.setTeamLevels(10, 12);

    useGameStore.getState().reset();

    expect(useGameStore.getState()).toMatchObject({
      gameId: null,
      myPlayerId: null,
      myPosition: null,
      hand: [],
      teamLevels: [2, 2],
    });
  });

  describe("derived state", () => {
    it("getSeatedParticipants excludes spectators", () => {
      const seated = makeParticipant({ id: "p0", position: 0 });
      const spectator = makeParticipant({ id: "p1", position: null });
      useGameStore.getState().updateParticipants([seated, spectator]);

      expect(getSeatedParticipants(useGameStore.getState())).toEqual([
        seated,
      ]);
    });

    it("getSpectators returns only participants without a seat", () => {
      const seated = makeParticipant({ id: "p0", position: 0 });
      const spectator = makeParticipant({ id: "p1", position: null });
      useGameStore.getState().updateParticipants([seated, spectator]);

      expect(getSpectators(useGameStore.getState())).toEqual([spectator]);
    });

    it("getMyTeam returns null when spectating", () => {
      expect(getMyTeam(useGameStore.getState())).toBeNull();
    });

    it.each([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
    ] as const)("getMyTeam maps position %i to team %i", (position, team) => {
      useGameStore.getState().setMyPosition(position);
      expect(getMyTeam(useGameStore.getState())).toBe(team);
    });

    it.each([
      [0, 2],
      [1, 3],
      [2, 0],
      [3, 1],
    ] as const)(
      "getTeammatePosition maps position %i to partner %i",
      (position, teammate) => {
        useGameStore.getState().setMyPosition(position);
        expect(getTeammatePosition(useGameStore.getState())).toBe(teammate);
      },
    );

    it("getTeammatePosition returns null when spectating", () => {
      expect(getTeammatePosition(useGameStore.getState())).toBeNull();
    });

    it("getIsMyTurn is true when currentPlayerTurn matches myPosition", () => {
      useGameStore.getState().setMyPosition(1);
      useGameStore.getState().setCurrentPlayerTurn(1);
      expect(getIsMyTurn(useGameStore.getState())).toBe(true);
    });

    it("getIsMyTurn is false when it's someone else's turn", () => {
      useGameStore.getState().setMyPosition(1);
      useGameStore.getState().setCurrentPlayerTurn(2);
      expect(getIsMyTurn(useGameStore.getState())).toBe(false);
    });

    it("getIsMyTurn is false while spectating", () => {
      useGameStore.getState().setCurrentPlayerTurn(0);
      expect(getIsMyTurn(useGameStore.getState())).toBe(false);
    });
  });
});
