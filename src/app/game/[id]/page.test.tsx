import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GamePage from "./page";
import type { GameContextValue } from "./GameProvider";
import type { GameParticipant } from "@/lib/types";

const useGameContextMock = jest.fn();
jest.mock("./GameProvider", () => ({
  useGameContext: () => useGameContextMock(),
}));

function makeParticipant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PARTICIPANTS: GameParticipant[] = [
  makeParticipant({ id: "p0", playerName: "Alice", position: 0 }),
  makeParticipant({ id: "p1", playerName: "Bob", position: 1 }),
  makeParticipant({ id: "p2", playerName: "Carol", position: 2 }),
  makeParticipant({ id: "p3", playerName: "Dave", position: 3 }),
];

// Every field GamePage reads off useGameContext() (i.e. useGame()'s return
// shape, Task 4.4) plus the gameId GameProvider adds - see baseContext
// overrides per test for what each one exercises.
function baseContext(overrides: Partial<GameContextValue> = {}): GameContextValue {
  return {
    gameId: "game-1",
    gameStatus: "in_progress",
    participants: PARTICIPANTS,
    myPosition: 0,
    hand: [{ suit: "SPADES", rank: "3" }],
    currentTrick: [{ position: 1, play: [{ suit: "HEARTS", rank: "4" }] }],
    currentPlayerTurn: 0,
    teamLevels: [2, 2],
    winningTeam: null,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    playCards: jest.fn().mockResolvedValue(undefined),
    isPlayingCards: false,
    playCardsError: null,
    pass: jest.fn().mockResolvedValue(undefined),
    isPassing: false,
    passError: null,
    joinGame: jest.fn(),
    isJoiningGame: false,
    joinGameError: null,
    exchangeCards: jest.fn(),
    isExchangingCards: false,
    exchangeCardsError: null,
    startGame: jest.fn().mockResolvedValue({ success: true, hand: [] }),
    isStartingGame: false,
    startGameError: null,
    ...overrides,
  } as unknown as GameContextValue;
}

describe("GamePage", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state while the game is hydrating", () => {
    useGameContextMock.mockReturnValue(baseContext({ isLoading: true }));
    render(<GamePage />);
    expect(screen.getByTestId("game-loading")).toBeInTheDocument();
  });

  it("shows an error state when hydration fails", () => {
    useGameContextMock.mockReturnValue(baseContext({ error: new Error("Game not found") }));
    render(<GamePage />);
    expect(screen.getByTestId("game-error")).toHaveTextContent("Game not found");
  });

  it("shows the waiting room while the game hasn't started", () => {
    useGameContextMock.mockReturnValue(baseContext({ gameStatus: "waiting" }));
    render(<GamePage />);
    expect(screen.getByTestId("waiting-room")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-room-seats")).toHaveTextContent("Alice");
    expect(screen.getByTestId("waiting-room-link")).toHaveValue(
      `${window.location.origin}/game/game-1`,
    );
    // Already seated (myPosition: 0, baseContext's default) - nothing left
    // to join.
    expect(screen.queryByTestId("waiting-room-join-form")).not.toBeInTheDocument();
  });

  it("shows a start button once all 4 seats are filled and calls startGame when clicked", async () => {
    const startMock = jest.fn().mockResolvedValue({ success: true, hand: [] });
    useGameContextMock.mockReturnValue(
      baseContext({ gameStatus: "waiting", startGame: startMock }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    await user.click(screen.getByTestId("waiting-room-start-button"));
    expect(startMock).toHaveBeenCalled();
  });

  it("hides the start button when fewer than 4 seats are filled", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        gameStatus: "waiting",
        participants: PARTICIPANTS.slice(0, 2),
      }),
    );
    render(<GamePage />);
    expect(screen.queryByTestId("waiting-room-start-button")).not.toBeInTheDocument();
  });

  it("hides the start button from an unseated visitor even once all 4 seats are filled", () => {
    useGameContextMock.mockReturnValue(
      baseContext({ gameStatus: "waiting", myPosition: null }),
    );
    render(<GamePage />);
    expect(screen.queryByTestId("waiting-room-start-button")).not.toBeInTheDocument();
  });

  it("shows a start error from the waiting room", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        gameStatus: "waiting",
        startGameError: new Error("Game was already started by another player"),
      }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("waiting-room-start-error")).toHaveTextContent(
      "Game was already started by another player",
    );
  });

  it("lets an unseated visitor join from the waiting room, then refetches", async () => {
    const joinMock = jest.fn().mockResolvedValue({ spectator: false, position: 1, hand: [] });
    const refetchMock = jest.fn();
    useGameContextMock.mockReturnValue(
      baseContext({
        gameStatus: "waiting",
        myPosition: null,
        joinGame: joinMock,
        refetch: refetchMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    expect(screen.getByTestId("waiting-room-join-form")).toBeInTheDocument();
    await user.type(screen.getByTestId("waiting-room-name-input"), "Erin");
    await user.click(screen.getByTestId("waiting-room-join-button"));

    expect(joinMock).toHaveBeenCalledWith("Erin");
    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
  });

  it("shows a join error from the waiting room without navigating away", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        gameStatus: "waiting",
        myPosition: null,
        joinGameError: new Error("Failed to join game"),
      }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("waiting-room-join-error")).toHaveTextContent(
      "Failed to join game",
    );
  });

  it("renders the board once the game is in progress", () => {
    useGameContextMock.mockReturnValue(baseContext());
    render(<GamePage />);
    expect(screen.getByTestId("game-table")).toBeInTheDocument();
    expect(screen.getByTestId("score-board")).toBeInTheDocument();
    expect(screen.getByTestId("trick-display")).toBeInTheDocument();
    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
    expect(screen.getByTestId("action-buttons")).toBeInTheDocument();
  });

  it("shows a spectator note instead of the hand/actions when spectating", () => {
    useGameContextMock.mockReturnValue(baseContext({ myPosition: null }));
    render(<GamePage />);
    expect(screen.getByTestId("spectator-note")).toBeInTheDocument();
    expect(screen.queryByTestId("player-hand")).not.toBeInTheDocument();
    expect(screen.queryByTestId("action-buttons")).not.toBeInTheDocument();
  });

  it("shows a game-over message once the game is completed", () => {
    useGameContextMock.mockReturnValue(baseContext({ gameStatus: "completed", winningTeam: 0 }));
    render(<GamePage />);
    expect(screen.getByTestId("game-over-message")).toBeInTheDocument();
    expect(screen.queryByTestId("action-buttons")).not.toBeInTheDocument();
  });

  it("passes when the pass button is clicked", async () => {
    const passMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(baseContext({ pass: passMock }));
    const user = userEvent.setup();
    render(<GamePage />);

    await user.click(screen.getByTestId("pass-button"));
    expect(passMock).toHaveBeenCalled();
  });
});
