import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GamePage from "./page";
import type { GameContextValue } from "./GameProvider";
import type { CardExchangeActionData, GameAction, GameParticipant } from "@/lib/types";

const useGameContextMock = jest.fn();
jest.mock("./GameProvider", () => ({
  useGameContext: () => useGameContextMock(),
}));

// GamePage's own composition logic is what's under test here - the
// hook's actual fetching (loading/error/enabled) is already covered by
// useGameHistory.test.tsx, and mocking it wholesale (like GameProvider
// above) avoids every test needing a QueryClientProvider ancestor just to
// satisfy useGameHistory's internal useQuery call.
const useGameHistoryMock = jest.fn();
jest.mock("@/hooks/useGameHistory", () => ({
  useGameHistory: (...args: unknown[]) => useGameHistoryMock(...args),
}));

function makeParticipant(overrides: Partial<GameParticipant>): GameParticipant {
  return {
    id: "id",
    gameId: "game-1",
    playerName: "Player",
    playerId: "player-id",
    position: 0,
    hand: [],
    handCount: overrides.hand?.length ?? 0,
    handOrder: overrides.handOrder ?? null,
    isConnected: true,
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeat: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    isBot: false,
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
    myHandOrder: null,
    updateHandOrder: jest.fn(),
    currentTrick: [{ position: 1, play: [{ suit: "HEARTS", rank: "4" }] }],
    currentPlayerTurn: 0,
    roundId: "round-1",
    roundStatus: "in_progress",
    finishingPositions: null,
    pendingTributeChoice: null,
    pendingGiverChoice: null,
    roundActions: [],
    teamLevels: [2, 2],
    winningTeam: null,
    connectionStatus: "connected",
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
    chooseTribute: jest.fn(),
    isChoosingTribute: false,
    chooseTributeError: null,
    chooseGiverCard: jest.fn(),
    isChoosingGiverCard: false,
    chooseGiverCardError: null,
    startGame: jest.fn().mockResolvedValue({ success: true, hand: [] }),
    isStartingGame: false,
    startGameError: null,
    ...overrides,
  } as unknown as GameContextValue;
}

describe("GamePage", () => {
  beforeEach(() => {
    useGameHistoryMock.mockReturnValue({
      actions: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
  });
  afterEach(() => {
    jest.clearAllMocks();
    // PlayerHand's own mount effect writes to localStorage under
    // persistenceKey (default `${gameId}:${myPosition}` = "game-1:0" across
    // most tests here), so leftover state from one test could otherwise
    // affect another's hand-order-dependent assertions.
    window.localStorage.clear();
  });

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
    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
    expect(screen.getByTestId("action-buttons")).toBeInTheDocument();
  });

  it("keeps selection attached to the same card when realtime hand updates remove a preceding card", () => {
    const firstCard = { suit: "SPADES" as const, rank: "3" as const };
    const selectedCard = { suit: "CLUBS" as const, rank: "4" as const };
    useGameContextMock.mockReturnValue(
      baseContext({ hand: [firstCard, selectedCard] }),
    );
    const { rerender } = render(<GamePage />);

    fireEvent.click(screen.getByLabelText("4 of clubs"));
    expect(screen.getByLabelText("4 of clubs")).toHaveAttribute("aria-pressed", "true");

    useGameContextMock.mockReturnValue(baseContext({ hand: [selectedCard] }));
    rerender(<GamePage />);

    expect(screen.getByLabelText("4 of clubs")).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the hand in the server-saved order when there's nothing in localStorage yet", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        hand: [
          { suit: "CLUBS", rank: "3" },
          { suit: "HEARTS", rank: "7" },
        ],
        myHandOrder: ["7H#0", "3C#0"],
      }),
    );
    render(<GamePage />);

    const labels = screen
      .getByTestId("player-hand")
      .querySelectorAll('[data-testid="card"]');
    expect(Array.from(labels).map((c) => c.getAttribute("aria-label"))).toEqual([
      "7 of hearts",
      "3 of clubs",
    ]);
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

  it("tells the viewer their team won", () => {
    // baseContext's default myPosition is 0 (team A, i.e. team 0).
    useGameContextMock.mockReturnValue(baseContext({ gameStatus: "completed", winningTeam: 0 }));
    render(<GamePage />);
    expect(screen.getByTestId("game-over-message")).toHaveTextContent("your team wins");
  });

  it("tells the viewer their team lost", () => {
    useGameContextMock.mockReturnValue(
      baseContext({ gameStatus: "completed", winningTeam: 1, myPosition: 0 }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("game-over-message")).toHaveTextContent("your team lost");
  });

  it("tells a spectator which team won by letter", () => {
    useGameContextMock.mockReturnValue(
      baseContext({ gameStatus: "completed", winningTeam: 1, myPosition: null }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("game-over-message")).toHaveTextContent("Team B wins");
  });

  it("passes when the pass button is clicked", async () => {
    const passMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(baseContext({ pass: passMock }));
    const user = userEvent.setup();
    render(<GamePage />);

    await user.click(screen.getByTestId("pass-button"));
    expect(passMock).toHaveBeenCalled();
  });

  it("shows a hand-ended message once the round has concluded but end-hand hasn't resolved it yet", () => {
    useGameContextMock.mockReturnValue(baseContext({ currentPlayerTurn: null }));
    render(<GamePage />);
    expect(screen.getByTestId("hand-ended-message")).toBeInTheDocument();
    expect(screen.queryByTestId("action-buttons")).not.toBeInTheDocument();
  });

  it("renders the card exchange modal during the card_exchange phase, and submits a return", async () => {
    const exchangeCardsMock = jest.fn().mockResolvedValue(undefined);
    const initialExchange: GameAction = {
      id: "a1",
      gameId: "game-1",
      roundId: "round-1",
      playerId: "system",
      actionType: "card_exchange",
      actionData: {
        from: 3,
        to: 0,
        card: { suit: "SPADES", rank: "ACE" },
        type: "initial",
      } satisfies CardExchangeActionData,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    useGameContextMock.mockReturnValue(
      baseContext({
        roundStatus: "card_exchange",
        roundActions: [initialExchange],
        hand: [{ suit: "CLUBS", rank: "3" }],
        exchangeCards: exchangeCardsMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    expect(screen.getByTestId("card-exchange-modal")).toBeInTheDocument();
    // CardExchangeModal reuses the same draggable/reorderable PlayerHand as
    // live play, so a player can rearrange their fresh hand before picking
    // which card to give back.
    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
    const handCards = screen.getByTestId("return-card-options").querySelectorAll('[data-testid="card"]');
    await user.click(handCards[0]);
    await user.click(screen.getByTestId("submit-return-button"));

    expect(exchangeCardsMock).toHaveBeenCalledWith({
      cardToGive: { suit: "CLUBS", rank: "3" },
    });
  });

  it("lets 1st place resolve a tied tribute choice", async () => {
    const chooseTributeMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(
      baseContext({
        roundStatus: "awaiting_tribute_choice",
        finishingPositions: [1, 3, 2, 4],
        pendingTributeChoice: {
          thirdPosition: 1,
          thirdCard: { suit: "CLUBS", rank: "9" },
          fourthPosition: 3,
          fourthCard: { suit: "SPADES", rank: "9" },
        },
        chooseTribute: chooseTributeMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    expect(screen.getByTestId("tribute-choice-modal")).toBeInTheDocument();
    // The tribute choice floats above the player's own hand rather than
    // replacing it, so they can compare against it while deciding.
    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
    const options = screen.getAllByTestId("tribute-choice-option");
    await user.click(within(options[0]).getByTestId("card"));
    expect(chooseTributeMock).toHaveBeenCalledWith(1);
  });

  it("shows a waiting message for the tribute choice when the viewer isn't 1st place", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        myPosition: 1,
        roundStatus: "awaiting_tribute_choice",
        finishingPositions: [1, 3, 2, 4],
        pendingTributeChoice: {
          thirdPosition: 1,
          thirdCard: { suit: "CLUBS", rank: "9" },
          fourthPosition: 3,
          fourthCard: { suit: "SPADES", rank: "9" },
        },
      }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("tribute-choice-waiting")).toBeInTheDocument();
    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
  });

  it("keeps a pending giver's full hand visible and lets them give a tied best card", async () => {
    const chooseGiverCardMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(
      baseContext({
        roundStatus: "awaiting_giver_choice",
        // Level rank is "2" for teamLevels [2, 2] - neither King is wild, so
        // they're a genuine tie.
        hand: [
          { suit: "SPADES", rank: "KING" },
          { suit: "HEARTS", rank: "KING" },
          { suit: "CLUBS", rank: "4" },
        ],
        pendingGiverChoice: { levelRank: "2", pendingPositions: [0], resolvedCards: {} },
        chooseGiverCard: chooseGiverCardMock,
        // Tribute selection happens between hands, so no player has a turn.
        currentPlayerTurn: null,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    expect(screen.getByTestId("player-hand")).toBeInTheDocument();
    expect(screen.getByTestId("tribute-give-instruction")).toHaveTextContent("highest eligible cards");
    expect(screen.queryByTestId("action-buttons")).not.toBeInTheDocument();
    expect(screen.queryByTestId("giver-card-choice-modal")).not.toBeInTheDocument();
    const cards = screen.getByTestId("player-hand").querySelectorAll('[data-testid="card"]');
    expect(cards).toHaveLength(3);

    // A lower card remains visible but cannot be given.
    await user.click(cards[2]);
    expect(screen.getByTestId("give-tribute-button")).toBeDisabled();
    expect(screen.getByTestId("tribute-give-invalid-reason")).toBeInTheDocument();

    await user.click(cards[2]);
    await user.click(cards[1]);
    expect(screen.getByTestId("give-tribute-button")).toBeEnabled();
    await user.click(screen.getByTestId("give-tribute-button"));
    expect(chooseGiverCardMock).toHaveBeenCalledWith({ suit: "HEARTS", rank: "KING" });
  });

  it("shows a waiting message for the giver choice when the viewer isn't the one who owes it", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        myPosition: 0,
        roundStatus: "awaiting_giver_choice",
        pendingGiverChoice: { levelRank: "2", pendingPositions: [1], resolvedCards: {} },
      }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("giver-choice-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("tribute-give-controls")).not.toBeInTheDocument();
  });

  it("always opens the selector for a selected wild card, even when playing it as itself would already be legal", async () => {
    const playCardsMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(
      baseContext({
        // Level rank is "2" for teamLevels [2, 2] - the heart 2 is wild, and
        // a lone card is already a valid single on an empty trick. The
        // selector should still open so the player can decide how it's
        // played rather than that being inferred silently.
        hand: [{ suit: "HEARTS", rank: "2" }],
        currentTrick: [],
        playCards: playCardsMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    const cards = screen.getByTestId("player-hand").querySelectorAll('[data-testid="card"]');
    await user.click(cards[0]);

    expect(screen.getByTestId("wild-card-selector")).toBeInTheDocument();
    expect(screen.getByTestId("play-button")).toBeDisabled();

    await user.click(screen.getByTestId("wild-card-play-as-itself-button"));

    expect(screen.queryByTestId("wild-card-selector")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("play-button")).toBeEnabled());
    await user.click(screen.getByTestId("play-button"));
    expect(playCardsMock).toHaveBeenCalledWith([
      { suit: "HEARTS", rank: "2", actsAs: { rank: "2", suit: "HEARTS" } },
    ]);
  });

  it("prompts for a wild-card interpretation when the raw selection isn't already legal, then plays with actsAs attached", async () => {
    const playCardsMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(
      baseContext({
        // Level rank is "2" for teamLevels [2, 2] - the heart 2 is wild.
        // Paired with a 5, the raw selection (heart 2 as itself) isn't a
        // legal pair, so it can only be played by declaring a wild
        // interpretation.
        hand: [{ suit: "HEARTS", rank: "2" }, { suit: "CLUBS", rank: "5" }],
        currentTrick: [],
        playCards: playCardsMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    const cards = screen.getByTestId("player-hand").querySelectorAll('[data-testid="card"]');
    await user.click(cards[0]);
    await user.click(cards[1]);

    expect(screen.getByTestId("wild-card-selector")).toBeInTheDocument();
    expect(screen.getByTestId("play-button")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "diamonds" }));
    await user.click(screen.getByTestId("wild-card-confirm-button"));

    expect(screen.queryByTestId("wild-card-selector")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("play-button")).toBeEnabled());
    await user.click(screen.getByTestId("play-button"));

    expect(playCardsMock).toHaveBeenCalledWith([
      { suit: "HEARTS", rank: "2", actsAs: { rank: "5", suit: "DIAMONDS" } },
      { suit: "CLUBS", rank: "5" },
    ]);
  });

  it("prompts once per wild card when two are selected together (a double deck can hold two level-rank hearts)", async () => {
    const playCardsMock = jest.fn().mockResolvedValue(undefined);
    useGameContextMock.mockReturnValue(
      baseContext({
        // Level rank is "2" - both hearts are wild. Raw selection (2H, 2H,
        // 9C, 9S) isn't a legal combo on its own (two ranks, not a
        // recognized shape); it only becomes a bomb_4 of 9s once both
        // hearts are each assigned a wild interpretation of "9".
        hand: [
          { suit: "HEARTS", rank: "2" },
          { suit: "HEARTS", rank: "2" },
          { suit: "CLUBS", rank: "9" },
          { suit: "SPADES", rank: "9" },
        ],
        currentTrick: [],
        playCards: playCardsMock,
      }),
    );
    const user = userEvent.setup();
    render(<GamePage />);

    const cards = screen.getByTestId("player-hand").querySelectorAll('[data-testid="card"]');
    for (const card of Array.from(cards)) {
      await user.click(card);
    }

    expect(screen.getByTestId("wild-card-selector")).toBeInTheDocument();
    expect(screen.getByTestId("play-button")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "diamonds" }));
    await user.click(screen.getByTestId("wild-card-confirm-button"));

    // Still needs the second heart's interpretation - selector stays open,
    // Play stays disabled.
    expect(screen.getByTestId("wild-card-selector")).toBeInTheDocument();
    expect(screen.getByTestId("play-button")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "clubs" }));
    await user.click(screen.getByTestId("wild-card-confirm-button"));

    expect(screen.queryByTestId("wild-card-selector")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("play-button")).toBeEnabled());
    await user.click(screen.getByTestId("play-button"));

    expect(playCardsMock).toHaveBeenCalledWith([
      { suit: "HEARTS", rank: "2", actsAs: { rank: "9", suit: "DIAMONDS" } },
      { suit: "HEARTS", rank: "2", actsAs: { rank: "9", suit: "CLUBS" } },
      { suit: "CLUBS", rank: "9" },
      { suit: "SPADES", rank: "9" },
    ]);
  });

  it("hides the connection banner while connected", () => {
    useGameContextMock.mockReturnValue(baseContext({ connectionStatus: "connected" }));
    render(<GamePage />);
    expect(screen.queryByTestId("connection-status-banner")).not.toBeInTheDocument();
  });

  it("shows a reconnecting banner", () => {
    useGameContextMock.mockReturnValue(baseContext({ connectionStatus: "reconnecting" }));
    render(<GamePage />);
    expect(screen.getByTestId("connection-status-banner")).toHaveTextContent("Reconnecting");
  });

  it("shows the connection banner in the waiting room too", () => {
    useGameContextMock.mockReturnValue(
      baseContext({ gameStatus: "waiting", connectionStatus: "disconnected" }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("connection-status-banner")).toHaveTextContent("Connection lost");
  });

  it("lists spectators on the in-progress board", () => {
    useGameContextMock.mockReturnValue(
      baseContext({
        participants: [
          ...PARTICIPANTS,
          makeParticipant({ id: "spec-1", playerName: "Erin", position: null }),
        ],
      }),
    );
    render(<GamePage />);
    expect(screen.getByTestId("spectator-list")).toHaveTextContent("Erin");
  });

  it("always shows the history panel with its fetched entries, no toggle required", () => {
    useGameHistoryMock.mockReturnValue({
      actions: [
        {
          id: "action-1",
          gameId: "game-1",
          roundId: "round-1",
          playerId: "player-id",
          actionType: "pass",
          actionData: {},
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    useGameContextMock.mockReturnValue(baseContext());
    render(<GamePage />);

    expect(screen.getByTestId("game-history-panel")).toBeInTheDocument();
    expect(screen.getByTestId("game-history")).toHaveTextContent("Alice passed");
  });

  it("refetches the history panel when a new trick action arrives", () => {
    const refetchMock = jest.fn();
    useGameHistoryMock.mockReturnValue({ actions: [], isLoading: false, error: null, refetch: refetchMock });
    useGameContextMock.mockReturnValue(baseContext());
    const { rerender } = render(<GamePage />);
    refetchMock.mockClear();

    // A new play landing broadcasts a fresh currentTrick array (see
    // useGame.ts's applyGameState/updateTrick) - simulated here by
    // re-rendering with a new array reference for the same field.
    useGameContextMock.mockReturnValue(
      baseContext({ currentTrick: [{ position: 2, play: [{ suit: "CLUBS", rank: "5" }] }] }),
    );
    rerender(<GamePage />);

    expect(refetchMock).toHaveBeenCalled();
  });

  it("doesn't fetch history while still in the waiting room", () => {
    useGameHistoryMock.mockReturnValue({ actions: [], isLoading: false, error: null, refetch: jest.fn() });
    useGameContextMock.mockReturnValue(baseContext({ gameStatus: "waiting" }));
    render(<GamePage />);

    expect(useGameHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
