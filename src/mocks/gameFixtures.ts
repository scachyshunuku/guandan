// Fixtures for the interactive, DB-free game preview at /mocks/game-preview.
// The preview uses these values to exercise the real table, hand, and action
// components without spinning up the DB-backed game flow (create → join →
// fill-with-bots → start) just to get pixels on screen.

import { PASS } from "@/lib/types";
import type {
  Card,
  CurrentTrick,
  Game,
  GameAction,
  GameActionData,
  GameActionType,
  GameParticipant,
  CardWithWild,
  PlayerPosition,
  Rank,
  Suit,
} from "@/lib/types";

const SUITS: readonly Suit[] = ["CLUBS", "HEARTS", "SPADES", "DIAMONDS"];
const RANKS: readonly Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
];

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export const mockGame: Pick<Game, "teamALevel" | "teamBLevel" | "winningTeam"> = {
  teamALevel: 7,
  teamBLevel: 5,
  winningTeam: null,
};

export const mockParticipants: GameParticipant[] = [
  {
    id: "participant-0",
    gameId: "mock-game",
    playerName: "Alice",
    playerId: "player-0",
    position: 0,
    hand: [],
    handCount: 10,
    handOrder: null,
    isConnected: true,
    connectedAt: "",
    lastHeartbeat: "",
    createdAt: "",
    isBot: false,
  },
  {
    id: "participant-1",
    gameId: "mock-game",
    playerName: "Bob",
    playerId: "player-1",
    position: 1,
    hand: [],
    handCount: 11,
    handOrder: null,
    isConnected: true,
    connectedAt: "",
    lastHeartbeat: "",
    createdAt: "",
    isBot: true,
  },
  {
    id: "participant-2",
    gameId: "mock-game",
    playerName: "Carol",
    playerId: "player-2",
    position: 2,
    hand: [],
    handCount: 9,
    handOrder: null,
    isConnected: false,
    connectedAt: "",
    lastHeartbeat: "",
    createdAt: "",
    isBot: false,
  },
  {
    id: "participant-3",
    gameId: "mock-game",
    playerName: "Dave",
    playerId: "player-3",
    position: 3,
    hand: [],
    handCount: 13,
    handOrder: null,
    isConnected: true,
    connectedAt: "",
    lastHeartbeat: "",
    createdAt: "",
    isBot: true,
  },
  {
    id: "participant-4",
    gameId: "mock-game",
    playerName: "Eve",
    playerId: "player-4",
    position: null,
    hand: [],
    handCount: 0,
    handOrder: null,
    isConnected: true,
    connectedAt: "",
    lastHeartbeat: "",
    createdAt: "",
    isBot: false,
  },
];

// A face-up hand for Player 1. It contains several pairs, including K♠/K♦,
// which is a legal response to Player 4's J♥/J♠ in the mock trick below.
export const mockHand: CardWithWild[] = [
  card("3", "CLUBS"),
  card("3", "DIAMONDS"),
  card("5", "HEARTS"),
  card("5", "SPADES"),
  card("KING", "SPADES"),
  card("KING", "DIAMONDS"),
  card("QUEEN", "HEARTS"),
  card("QUEEN", "SPADES"),
  card("ACE", "CLUBS"),
  card("ACE", "DIAMONDS"),
];

// A valid double-play trick that has gone around more than once (RULES.md - a
// trick only ends after three consecutive passes), so GameTable's grid has
// several columns and the interactive preview can show K♠/K♦ beating the
// final J♥/J♠ play.
export const mockCurrentTrick: CurrentTrick = [
  { position: 0, play: [card("2", "HEARTS"), card("2", "SPADES")] },
  { position: 1, play: PASS },
  { position: 2, play: [card("4", "SPADES"), card("4", "CLUBS")] },
  { position: 3, play: [card("6", "HEARTS"), card("6", "DIAMONDS")] },
  { position: 0, play: PASS },
  { position: 1, play: PASS },
  { position: 2, play: [card("8", "SPADES"), card("8", "SPADES")] },
  { position: 3, play: [card("JACK", "HEARTS"), card("JACK", "SPADES")] },
];

// Kept as a named alias so the preview makes its interactive fixture
// dependency explicit while other callers can use the full trick fixture.
export const mockInteractiveTrick: CurrentTrick = mockCurrentTrick;

// Long enough to force real scrolling inside the history panel - the whole
// point of this fixture is to prove the panel clips to the game table's
// height instead of growing to fit every entry.
function buildMockActions(count: number): GameAction[] {
  const actions: GameAction[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const position = (i % 4) as PlayerPosition;
    const participant = mockParticipants[position];
    const createdAt = new Date(now - (count - i) * 15_000).toISOString();
    let actionType: GameActionType;
    let actionData: GameActionData;

    if (i % 7 === 6) {
      actionType = "trick_end";
      actionData = { winnerPosition: position };
    } else if (i % 5 === 4) {
      actionType = "pass";
      actionData = {};
    } else if (i % 11 === 3) {
      actionType = "player_finished";
      actionData = { position, place: ((i % 4) + 1) as 1 | 2 | 3 | 4 };
    } else {
      actionType = "card_played";
      actionData = {
        position,
        cards: [card(RANKS[i % RANKS.length], SUITS[i % SUITS.length])],
      };
    }

    actions.push({
      id: `mock-action-${i}`,
      gameId: "mock-game",
      roundId: "mock-round",
      playerId: participant.playerId,
      actionType,
      actionData,
      createdAt,
    });
  }

  return actions;
}

// Oldest-first, matching GET /api/game/[id]/history (GameHistory reverses it
// for display) - see GameHistory.tsx's doc comment.
export const mockActions: GameAction[] = buildMockActions(60);
