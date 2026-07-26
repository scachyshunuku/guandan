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
// the leader. Each entry records which position acted *explicitly*, rather
// than being derived from array index + leaderPosition: once a player has
// gone out (emptied their hand) mid-round, they take no further turns, so a
// trick's rotation no longer necessarily visits every position, and if the
// trick winner has gone out their partner leads next rather than the next
// seat in line (RULES.md "Leader Selection") — either of which breaks
// `(leaderPosition + n) % 4` as a way to recover who acted. Empty right after
// a round is dealt or right after a trick resolves and the next one hasn't
// started yet. The lead combo type the trick must beat is derived from the
// last non-PASS entry (there's no play before it to beat).
export interface TrickEntry {
  position: PlayerPosition;
  play: TrickPlay;
}
export type CurrentTrick = TrickEntry[];

export interface GameState {
  currentTrick: CurrentTrick;
  trickCount: number; // tricks completed so far this round
  // Positions in the order their hands emptied so far this round — the
  // input shape gameRules/scoring.ts's detectRoundEnd expects, and what lets
  // play-cards/pass (Task 3.2) skip finished players in future turn
  // rotations instead of freezing the round the instant anyone goes out.
  // Empty at the start of a round; a fresh round starts this array over.
  finishOrder: PlayerPosition[];
  // Set by end-hand only for a two-team-lead (1-2) finish whose 3rd/4th
  // tribute cards tie in rank (RULES.md "Two-Team Lead": "If the two cards
  // are the same rank, 1st place chooses which card to take") — holds
  // everything POST /api/game/[id]/choose-tribute needs to finish the
  // exchange once 1st place decides. Cleared (round moves to
  // 'card_exchange') once that choice is submitted.
  pendingTributeChoice?: {
    thirdPosition: PlayerPosition;
    thirdCard: Card;
    fourthPosition: PlayerPosition;
    fourthCard: Card;
  };
  // RULES.md "Card Exchange" → "Best card, when tied": a giver (3rd and/or
  // 4th place) whose own hand has multiple cards tied for their best card
  // must choose which one to give — mirrors pendingTributeChoice, but for
  // the giver's side of the exchange instead of the recipient's. Set only
  // while roundStatus is 'awaiting_giver_choice'; cleared once every
  // pending position has resolved (round moves on to
  // 'awaiting_tribute_choice' if the two givers' resolved cards now tie
  // with each other, or straight to 'card_exchange' otherwise).
  pendingGiverChoice?: {
    // The just-finished hand's level (RULES.md "Level Cards & Wild Cards"),
    // captured once here rather than re-derived from the game's team
    // levels later — those may already have been promoted by the time a
    // later giver's choice or the final cross-giver comparison needs it.
    levelRank: StandardRank;
    pendingPositions: PlayerPosition[];
    resolvedCards: Partial<Record<PlayerPosition, Card>>;
  };
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export type GameStatus = "waiting" | "in_progress" | "completed";
// 'awaiting_giver_choice': a giver (3rd and/or 4th place) whose own hand has
// multiple cards tied for their best card — waiting on POST
// /api/game/[id]/choose-giver-card before the round can move on (either to
// 'awaiting_tribute_choice', if the resolved cards then tie with each
// other, or straight to 'card_exchange').
// 'awaiting_tribute_choice': a two-team-lead (1-2) finish whose 3rd/4th
// tribute cards tied in rank (RULES.md "Two-Team Lead") — waiting on 1st
// place to choose via POST /api/game/[id]/choose-tribute before the round
// can move on to 'card_exchange'.
export type RoundStatus =
  | "in_progress"
  | "awaiting_giver_choice"
  | "awaiting_tribute_choice"
  | "card_exchange"
  | "completed";
export type GameActionType =
  | "card_played"
  | "pass"
  | "trick_end"
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

// Logged by whichever request (play-cards or pass) resolves a trick, i.e.
// advanceTrick's `trickWinner` was non-null - see gameRules/turnAdvance.ts.
export interface TrickEndActionData {
  winnerPosition: PlayerPosition;
}

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
  | TrickEndActionData
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

// ARCHITECTURE.md "Disconnect & Reconnect": the client pings this
// periodically to keep its participant row's `lastHeartbeat` fresh; the
// server derives `isConnected` from that (gameStateResponse.ts) rather than
// trusting a client-reported connection state, and also sweeps every other
// participant in the game for staleness on each call.
export interface HeartbeatRequest {
  playerId: string;
}

export interface HeartbeatResponse {
  success: true;
}

export interface StartGameRequest {
  playerId: string;
}

export interface StartGameResponse {
  success: true;
  hand: CardWithWild[];
}

// No `position` field: the server derives it from `playerId` (a
// participant's seat is fixed at join and never reassigned — see
// gameDb.ts's resolveTurn), so a client-submitted one would only be a
// redundant, spoofable copy of a value the server already knows.
export interface PlayCardsRequest {
  cards: CardWithWild[];
  playerId: string;
}

export type PlayCardsResponse =
  | { success: true }
  | { success: false; error: string; reason: string };

// See PlayCardsRequest's comment on why there's no `position` field.
export interface PassRequest {
  playerId: string;
}

export interface PassResponse {
  success: true;
}

export interface EndHandRequest {
  playerId: string;
}

export interface EndHandResponse {
  success: true;
}

// RULES.md "Card Exchange" → "Best card, when tied": a giver (3rd and/or
// 4th place) whose own hand has multiple cards tied for their best card
// chooses which one to give — `card` must be one of those tied candidates.
// No `position` field (see PlayCardsRequest's comment).
export interface ChooseGiverCardRequest {
  playerId: string;
  card: Card;
}

export type ChooseGiverCardResponse =
  | { success: true }
  | { success: false; error: string; reason: string };

// RULES.md "Two-Team Lead": "If the two cards are the same rank, 1st place
// chooses which card to take (then 2nd place gets the other)." `take`
// identifies whose tribute card 1st place is taking — the other tied
// position's card goes to 2nd place instead. No `position` field: see
// PlayCardsRequest's comment — the caller's own seat is derived server-side,
// though `take` itself is a genuine choice only the client can make.
export interface ChooseTributeRequest {
  playerId: string;
  take: PlayerPosition;
}

export type ChooseTributeResponse =
  | { success: true }
  | { success: false; error: string; reason: string };

// No `position` field (see PlayCardsRequest's comment). No `type` field
// either: this route only ever accepts a 'return' exchange — the 'initial'
// half is automatic (applied by end-hand), not something a client can
// submit — so a client-submitted type could only ever be one legal value.
// No `recipientPosition` either: exchange-cards derives who the caller owes
// a return to from the 'initial' card_exchange game_actions history (who
// gave them their card), the same server-known-better-than-the-client
// reasoning as `position`.
export interface ExchangeCardsRequest {
  playerId: string;
  cardToGive: Card;
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
