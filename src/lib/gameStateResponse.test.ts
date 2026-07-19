import { buildGameStateResponse, redactParticipantHands } from "./gameStateResponse";
import type { Game, GameAction, GameParticipant, GameRound } from "@/lib/types";

function participant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "participant-1",
    gameId: "game-1",
    playerName: "Player",
    playerId: "session-1",
    position: 0,
    hand: [{ rank: "ACE", suit: "SPADES" }],
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00Z",
    lastHeartbeat: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("redactParticipantHands", () => {
  it("reveals only the requesting player's own hand", () => {
    const alice = participant({
      playerId: "alice",
      position: 0,
      hand: [{ rank: "ACE", suit: "SPADES" }],
    });
    const bob = participant({
      playerId: "bob",
      position: 1,
      hand: [{ rank: "KING", suit: "HEARTS" }],
    });

    const { participants, myHand } = redactParticipantHands([alice, bob], "alice");

    expect(myHand).toEqual([{ rank: "ACE", suit: "SPADES" }]);
    expect(participants.find((p) => p.playerId === "alice")?.hand).toEqual([
      { rank: "ACE", suit: "SPADES" },
    ]);
    expect(participants.find((p) => p.playerId === "bob")?.hand).toEqual([]);
  });

  it("redacts every hand and returns an empty myHand for a spectator", () => {
    const alice = participant({ playerId: "alice", hand: [{ rank: "ACE", suit: "SPADES" }] });
    const bob = participant({ playerId: "bob", hand: [{ rank: "KING", suit: "HEARTS" }] });

    const { participants, myHand } = redactParticipantHands([alice, bob], "spectator-session");

    expect(myHand).toEqual([]);
    expect(participants.every((p) => p.hand.length === 0)).toBe(true);
  });

  it("redacts every hand when no playerId is provided", () => {
    const alice = participant({ playerId: "alice", hand: [{ rank: "ACE", suit: "SPADES" }] });

    const { participants, myHand } = redactParticipantHands([alice], null);

    expect(myHand).toEqual([]);
    expect(participants[0].hand).toEqual([]);
  });

  it("does not mutate the input participants", () => {
    const alice = participant({ playerId: "alice", hand: [{ rank: "ACE", suit: "SPADES" }] });

    redactParticipantHands([alice], "someone-else");

    expect(alice.hand).toEqual([{ rank: "ACE", suit: "SPADES" }]);
  });
});

describe("buildGameStateResponse", () => {
  const game: Game = {
    id: "game-1",
    status: "in_progress",
    teamALevel: 2,
    teamBLevel: 2,
    winningTeam: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const round: GameRound = {
    id: "round-1",
    gameId: "game-1",
    roundNumber: 1,
    gameState: { currentTrick: [], trickCount: 0 },
    currentPlayerTurn: 0,
    leaderPosition: 0,
    status: "in_progress",
    finishingPositions: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const roundActions: GameAction[] = [
    {
      id: "action-1",
      gameId: "game-1",
      roundId: "round-1",
      playerId: "alice",
      actionType: "pass",
      actionData: {},
      createdAt: "2026-01-01T00:00:01Z",
    },
  ];

  it("assembles game, round, redacted participants, myHand, and round actions", () => {
    const alice = participant({ playerId: "alice", hand: [{ rank: "ACE", suit: "SPADES" }] });
    const bob = participant({ playerId: "bob", hand: [{ rank: "KING", suit: "HEARTS" }] });

    const response = buildGameStateResponse(game, round, [alice, bob], "bob", roundActions);

    expect(response.game).toBe(game);
    expect(response.round).toBe(round);
    expect(response.myHand).toEqual([{ rank: "KING", suit: "HEARTS" }]);
    expect(response.participants.find((p) => p.playerId === "alice")?.hand).toEqual([]);
    expect(response.roundActions).toBe(roundActions);
  });

  it("allows a null round and empty round actions for a game that hasn't started yet", () => {
    const response = buildGameStateResponse(game, null, [], "alice", []);

    expect(response.round).toBeNull();
    expect(response.roundActions).toEqual([]);
  });
});
