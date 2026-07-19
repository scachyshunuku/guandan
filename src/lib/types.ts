// Shared TypeScript types for the Guandan game. See RULES.md for game rules
// and ARCHITECTURE.md (sections 2 and 8) for the schema and API this mirrors.

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Suit = "CLUBS" | "HEARTS" | "SPADES" | "DIAMONDS";

export type StandardRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "JACK"
  | "QUEEN"
  | "KING"
  | "ACE";

export type JokerRank = "BLACK_JOKER" | "RED_JOKER";

export type Rank = StandardRank | JokerRank;

export interface Card {
  // Omitted for jokers, which have no suit.
  suit?: Suit;
  rank: Rank;
}

// A card as played onto the table. Only a level-rank heart card can be wild
// (RULES.md "Level Cards & Wild Cards"); when played wild, `actsAs` records
// what it's standing in for. Jokers can never be impersonated.
export interface CardWithWild extends Card {
  actsAs?: { suit: Suit; rank: StandardRank };
}

// ---------------------------------------------------------------------------
// Combinations (RULES.md "Valid Plays")
// ---------------------------------------------------------------------------

export type OrdinaryComboType =
  | "single"
  | "pair"
  | "triple"
  | "full_house"
  | "straight"
  | "tube"
  | "plate";

// Ordered lowest to highest, per RULES.md "Bombs (9 types)".
export type BombComboType =
  | "bomb_4"
  | "bomb_5"
  | "straight_flush"
  | "bomb_6"
  | "bomb_7"
  | "bomb_8"
  | "bomb_9"
  | "bomb_10"
  | "joker_bomb";

export type ComboType = OrdinaryComboType | BombComboType;

// ---------------------------------------------------------------------------
// Players & positions
// ---------------------------------------------------------------------------

// Seat 0-3; partners sit opposite each other (0 & 2 vs. 1 & 3). `null` means
// spectator.
export type PlayerPosition = 0 | 1 | 2 | 3;

export type Team = 0 | 1; // team A = positions 0 & 2, team B = positions 1 & 3

// ---------------------------------------------------------------------------
// In-round state (game_rounds.game_state JSONB)
// ---------------------------------------------------------------------------

export const PASS = "PASS" as const;
export type Pass = typeof PASS;

// PASS: passed. CardWithWild[]: the combination played.
export type TrickPlay = CardWithWild[] | Pass;

// One entry per action taken so far this trick, in turn order starting from
// the leader (a trick is always exactly one rotation: each position acts
// once, and passing is final for the trick). Entry `n` was made by position
// `(leaderPosition + n) % 4`, where leaderPosition is GameRound.leaderPosition.
// Empty right after a round is dealt or right after a trick resolves and the
// next one hasn't started yet. The lead combo type the trick must beat is
// derived from the last non-PASS entry (there's no play before it to beat).
export type CurrentTrick = TrickPlay[];

export interface GameState {
  currentTrick: CurrentTrick;
  trickCount: number; // tricks completed so far this round
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "in_progress" | "completed";
export type RoundStatus = "in_progress" | "card_exchange" | "completed";
export type GameActionType =
  | "card_played"
  | "pass"
  | "card_exchange"
  | "join"
  | "leave";

export interface Game {
  id: string; // also the shareable game code used in URLs
  status: GameStatus;
  teamALevel: number; // 2-14, 14 = Ace
  teamBLevel: number; // 2-14, 14 = Ace
  winningTeam: Team | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameRound {
  id: string;
  gameId: string;
  roundNumber: number;
  gameState: GameState;
  currentPlayerTurn: PlayerPosition | null;
  leaderPosition: PlayerPosition | null;
  status: RoundStatus;
  // Indexed by player position; value is finishing order (1st-4th), e.g.
  // [1, 4, 2, 3] means position 0 finished 1st, position 1 finished 4th, etc.
  finishingPositions: number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameParticipant {
  id: string;
  gameId: string;
  playerName: string;
  playerId: string; // session-based id generated per connection
  position: PlayerPosition | null; // null = spectator
  hand: CardWithWild[];
  isConnected: boolean;
  connectedAt: string;
  lastHeartbeat: string;
  createdAt: string;
}

export interface CardPlayedActionData {
  cards: CardWithWild[];
  position: PlayerPosition;
}

export type PassActionData = Record<string, never>;

export interface CardExchangeActionData {
  from: PlayerPosition;
  to: PlayerPosition;
  card: Card;
  type: "initial" | "return";
}

export interface JoinActionData {
  playerName: string;
  // Seat assigned at join time (null = joined as spectator). Recorded here,
  // not just on GameParticipant, since a vacated seat can later be reused by
  // a different participant.
  position: PlayerPosition | null;
}

export interface LeaveActionData {
  playerName: string;
  // Seat vacated (null = was spectating). Recorded here, not just on
  // GameParticipant, because leaving deletes that participant row entirely
  // (ARCHITECTURE.md "Leaving/Disconnection") and reassigns the seat, so
  // there'd be nothing left to join against for this audit-log entry.
  position: PlayerPosition | null;
}

export type GameActionData =
  | CardPlayedActionData
  | PassActionData
  | CardExchangeActionData
  | JoinActionData
  | LeaveActionData;

export interface GameAction {
  id: string;
  gameId: string;
  roundId: string;
  playerId: string;
  actionType: GameActionType;
  actionData: GameActionData;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API request/response types (ARCHITECTURE.md section 8)
// ---------------------------------------------------------------------------

export interface CreateGameResponse {
  gameId: string;
}

export interface JoinGameRequest {
  playerName: string;
  playerId: string;
}

export type JoinGameResponse =
  | { spectator: false; position: PlayerPosition; hand: CardWithWild[] }
  | { spectator: true };

export interface LeaveGameRequest {
  playerId: string;
}

export interface LeaveGameResponse {
  success: true;
}

export interface StartGameRequest {
  playerId: string;
}

export interface StartGameResponse {
  success: true;
  hand: CardWithWild[];
}

export interface PlayCardsRequest {
  cards: CardWithWild[];
  playerId: string;
  position: PlayerPosition;
}

export type PlayCardsResponse =
  | { success: true }
  | { success: false; error: string; reason: string };

export interface PassRequest {
  playerId: string;
  position: PlayerPosition;
}

export interface PassResponse {
  success: true;
}

export interface ExchangeCardsRequest {
  playerId: string;
  position: PlayerPosition;
  cardToGive: Card;
  type: "initial" | "return";
  recipientPosition: PlayerPosition;
}

export type ExchangeCardsResponse =
  | { success: true }
  | { success: false; error: string; reason: string };

export interface GameStateResponse {
  game: Game;
  // null while the game is still 'waiting': the first game_rounds row isn't
  // created until start (ARCHITECTURE.md "Start Game").
  round: GameRound | null;
  participants: GameParticipant[];
  myHand: CardWithWild[];
  // This round's actions only (for replaying the current trick/round), not
  // the full game history — see GET /api/game/[code]/history for that.
  roundActions: GameAction[];
}

export interface GameActionsResponse {
  actions: GameAction[];
}
