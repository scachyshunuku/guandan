# Guandan Implementation Plan

Breaking down the build into independently testable tasks with maximum parallelism.

---

## Phase 1: Foundation (Week 1) - Blocking work

These tasks must be completed first as they unblock other work.

### Task 1.1: Project Setup
- [x] Create Next.js 14+ project with TypeScript
- [x] Configure Supabase client
- [x] Set up environment variables
- [x] Configure Vercel deployment
- **Blockers**: None
- **Enables**: All other tasks
- **Testability**: Manual only
- **Estimated**: 2 hours

### Task 1.2: Database Schema & Migrations
- [x] Create Supabase project
- [x] Write initial schema migration (games, game_rounds, game_participants, game_actions tables)
- [x] Create indexes
- [x] Set up RLS policies
- **Blockers**: Task 1.1
- **Enables**: Tasks 2.x (API routes)
- **Testability**: Manual verification in Supabase
- **Estimated**: 4 hours

### Task 1.3: Type Definitions
- [x] Create `lib/types.ts` with TypeScript interfaces:
  - Game, GameRound, GameParticipant, GameAction
  - Card, CardWithWild
  - GameState, CurrentTrick
  - API request/response types
- **Blockers**: None (can be done in parallel with 1.1)
- **Enables**: All other frontend/backend tasks
- **Testability**: TypeScript compilation
- **Estimated**: 3 hours

---

## Phase 2: Game Logic (Week 1-2) - Highly Testable, Independent

All of these can be done in parallel. Heavy unit test coverage.

### Task 2.1: Card Utilities
- [x] Create `lib/cardUtils.ts`:
  - Card ranking comparison
  - Card sorting by rank/suit
  - Get card rank as number (for comparisons)
  - Encode/decode card string representation
- [x] Unit tests: 100+ test cases (all combinations)
- **Blockers**: Task 1.3
- **Enables**: Tasks 2.2, 2.3, 3.x
- **Testability**: Unit tests with Jest
- **Estimated**: 6 hours

### Task 2.2: Combination Validation
- [x] Create `lib/gameRules/combinations.ts`:
  - `isValidSingle()`, `isValidPair()`, `isValidTriple()`, `isValidFullHouse()`, `isValidStraight()`, `isValidTube()`, `isValidPlate()`
  - `getComboType()` - identify combo type from cards
  - `getComboRank()` - rank for comparison (single vs pair vs bomb)
  - All 9 bomb types validation
- [x] Unit tests: 200+ test cases
- **Blockers**: Task 2.1
- **Enables**: Task 2.3, 3.x
- **Testability**: Unit tests with Jest
- **Estimated**: 8 hours

### Task 2.3: Play Validation
- [x] Create `lib/gameRules/validation.ts`:
  - `canPlayCards(cardsToPlay, hand, currentTrick, levelRank)` → boolean + reason
  - `isBeatingStraight(combo1, combo2)` → boolean
  - `beatsTrick(combo1, leadCombo, levelRank)` → boolean
  - Handle wild card logic (hearts of level rank)
- [x] Unit tests: 150+ test cases
- **Blockers**: Tasks 2.1, 2.2
- **Enables**: Task 3.1, 3.2
- **Testability**: Unit tests with Jest
- **Estimated**: 8 hours

### Task 2.4: Trick & Round Scoring
- [x] Create `lib/gameRules/scoring.ts`:
  - `calculateTrickWinner(currentTrick, leadPosition)` → position
  - `detectRoundEnd(participants)` → finishing positions
  - `calculateLevelPromotion(finishingPositions, currentTeamLevel)` → new level
- [x] Unit tests: 100+ test cases
- **Blockers**: Tasks 2.1, 2.3
- **Enables**: Task 3.2
- **Testability**: Unit tests with Jest
- **Estimated**: 6 hours

---

## Phase 3: Backend / API (Week 2) - Can start after Phase 1.2 & 2.x

### Task 3.1: Game Creation, Join & Start API
- [x] `POST /api/game/create` - Create new game
  - Generate UUID as game code (`games.id`)
  - Initialize game_rounds (round 1, empty state, no cards dealt yet)
  - Store in database with status='waiting'
  - Return game code
- [x] `POST /api/game/[id]/join` - Join existing game
  - Add to game_participants
  - Assign position (0-3) or mark as spectator
  - Return current game state
- [x] `POST /api/game/[id]/start` - Start the game once all 4 seats are filled
  - Validate all 4 positions are occupied and game is still 'waiting'
  - Shuffle 108 cards, deal 27 to each seated participant, store in game_participants.hand
  - Randomly select the first leader; set game_rounds.leader_position / current_player_turn
  - Set games.status = 'in_progress'
  - Return the caller's own hand (broadcasting the new state to other
    players is Task 4.2's realtimeSync/useGameRealtimeSync responsibility,
    not this route's — hands must never go out on the public `games:[id]`
    channel unscoped, see ARCHITECTURE.md RLS notes)
- [x] Unit tests: Create game, join as player, join as spectator, start requires 4 players, full game setup
- **Blockers**: Tasks 1.2, 1.3, 2.1
- **Enables**: Task 3.2, 4.x
- **Testability**: Integration tests with mock Supabase
- **Estimated**: 8 hours

### Task 3.2: Play Card API
- [x] `POST /api/game/[id]/play-cards`
  - Validate combination using Task 2.3
  - Validate it beats lead (if applicable)
  - Update game_rounds.game_state.currentTrick
  - Insert game_action
  - Check if trick ends (3 passes)
  - Check if hand ends (player out of cards)
  - Broadcast via Realtime
- [x] `POST /api/game/[id]/pass`
  - Increment pass counter
  - Check if trick ends
  - Move to next player
  - Broadcast
- [x] Integration tests: Valid plays, invalid plays, trick ending, hand ending
- **Blockers**: Tasks 1.2, 1.3, 2.3, 3.1
- **Enables**: Task 3.3
- **Testability**: Integration tests
- **Estimated**: 8 hours

### Task 3.3: Hand End & Card Exchange API
- [ ] `POST /api/game/[id]/end-hand`
  - Determine finishing positions
  - Determine exchange type (1-4, 1-3, 1-2)
  - Set game_rounds.status = 'card_exchange'
  - Broadcast (initial exchanges calculated)
- [ ] `POST /api/game/[id]/exchange-cards`
  - Validate player received card
  - Accept card selection for return
  - Insert card_exchange actions
  - When all returns done, move to deal next round
  - Update game_rounds.status = 'completed'
  - Create new game_rounds (round N+1)
  - Shuffle & deal cards
  - Check if game won (1-2 or 1-3 at level A)
  - Broadcast next round start
- [ ] Integration tests: Single-team lead, two-team lead, card selection, level promotion
- **Blockers**: Tasks 1.2, 1.3, 2.4, 3.2
- **Enables**: Task 4.x
- **Testability**: Integration tests
- **Estimated**: 10 hours

### Task 3.4: Game State Query API
- [x] `GET /api/game/[id]` - Get current game state
  - Return games, current game_rounds, game_participants with hands
  - Return game_actions for current round (for replay)
- [x] `GET /api/game/[id]/history` - Get complete game history
- [x] Unit tests: State serialization
- **Blockers**: Task 1.2
- **Enables**: Task 4.x
- **Testability**: Integration tests
- **Estimated**: 4 hours

---

## Phase 4: Frontend State & Real-time (Week 2) - Can start in parallel with Phase 3

### Task 4.1: Zustand Store Setup
- [x] Create `store/gameStore.ts`:
  - gameCode, gameStatus
  - participants, myPlayerId, myPosition, spectators
  - hand, currentTrick, currentPlayerTurn, scores
  - All mutations (setHand, updateTrick, updateParticipants, etc.)
- [x] Unit tests: Store updates, derived state
- **Blockers**: Task 1.3
- **Enables**: Task 4.2, 4.3
- **Testability**: Unit tests with mock Zustand
- **Estimated**: 5 hours

### Task 4.2: Supabase Real-time Hook
- [x] Create `hooks/useGameRealtimeSync.ts`:
  - Subscribe to games:[gameId] channel
  - Listen to game_rounds updates
  - Listen to game_actions inserts
  - Sync to Zustand store
  - Unsubscribe on unmount
- [x] Mock tests: Subscription setup, message handling
- **Blockers**: Tasks 4.1, 3.4
- **Enables**: Task 4.4
- **Testability**: Unit tests with mock Supabase
- **Estimated**: 5 hours

### Task 4.3: API Mutation Hooks
- [x] Create `hooks/useGameActions.ts`:
  - `playCards(cards)` - POST to play-cards
  - `pass()` - POST to pass
  - `joinGame(playerName)` - POST to join
  - `exchangeCards(cardToGive)` - POST to exchange
  - Error handling, loading states
- [x] Unit tests: Mutation calls, error handling
- **Blockers**: Task 4.1, 3.x
- **Enables**: Task 5.x
- **Testability**: Unit tests with mock fetch
- **Estimated**: 6 hours

### Task 4.4: Main Game Hook
- [ ] Create `hooks/useGame.ts`:
  - Combines Zustand + Realtime sync + API mutations
  - Manages optimistic updates
  - Handles reconnection
- [ ] Unit tests: Sync logic, optimistic updates
- **Blockers**: Tasks 4.2, 4.3
- **Enables**: Task 5.x
- **Testability**: Unit tests
- **Estimated**: 5 hours

---

## Phase 5: Frontend UI Components (Week 2-3) - Can start in parallel with Phase 4

All can be built with mocks, integrated later.

### Task 5.1: Card Component & Hand Display
- [x] `components/game/Card.tsx` - Single card visual
  - Display suit + rank
  - Show wild card indicator if `actsAs` present
  - Click handler for selection
  - Unit tests: Rendering, wild card display
- [x] `components/game/PlayerHand.tsx` - Player's hand
  - Grid of cards
  - Card selection (highlight selected)
  - Show/hide based on player position
  - Unit tests: Card selection, hand updates
- **Blockers**: Task 1.3
- **Testability**: Component tests with React Testing Library
- **Estimated**: 6 hours

### Task 5.2: Game Table Layout
- [x] `components/game/GameTable.tsx` - Main board
  - 4 player positions (north, south, east, west)
  - Center area for current trick
  - Score display
  - Current player indicator
  - Unit tests: Layout, rendering players
- [x] `components/game/PlayerCard.tsx` - Player bubble
  - Player name, position, connected status
  - Card count in hand
  - Unit tests: State rendering
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 6 hours

### Task 5.3: Trick Display
- [x] `components/game/TrickDisplay.tsx` - Show current trick plays
  - Render `currentTrick` array
  - Show plays in order (player position)
  - Display pass vs cards played
  - Show wild card `actsAs` notation
  - Unit tests: Array rendering, wild cards
- [x] `components/game/ScoreBoard.tsx` - Level & score display
  - Team A/B levels
  - Team A/B scores
  - Level progression visual
  - Unit tests: Data display
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 5 hours

### Task 5.4: Game Actions UI
- [ ] `components/game/ActionButtons.tsx`
  - Play button (enabled if valid combo selected)
  - Pass button
  - Unit tests: Button states
- [ ] `components/game/CardExchangeModal.tsx`
  - Show cards to exchange (read-only initial)
  - Selection UI for return cards
  - Submit button
  - Unit tests: Modal display, selection
- [ ] `components/game/WildCardSelector.tsx`
  - When playing wild card, show selector for what it acts as
  - All 13 ranks
  - All 4 suits
  - Unit tests: Selector rendering
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 7 hours

### Task 5.5: Lobby & Game Creation
- [ ] `components/lobby/CreateGameForm.tsx`
  - Button to create game
  - Copy game code link
  - Unit tests: Form submission
- [ ] `components/lobby/JoinGameForm.tsx`
  - Input: game code, player name
  - Submit to join
  - Unit tests: Validation, submission
- [ ] `app/page.tsx` - Home page
  - Create or join game
  - Unit tests: Navigation
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 5 hours

### Task 5.6: Pages & Layouts
- [ ] `app/layout.tsx` - Root layout with providers
  - Zustand provider
  - Supabase provider
  - Error boundary
- [ ] `app/game/[id]/layout.tsx` - Game page provider
  - Initialize useGame hook
  - Pass state to children
- [ ] `app/game/[id]/page.tsx` - Game board container
  - Render GameTable + PlayerHand + TrickDisplay
  - Handle game state
- [ ] Unit tests: Provider setup
- **Blockers**: Tasks 4.1, 4.4, 5.1-5.4
- **Testability**: Component tests
- **Estimated**: 4 hours

---

## Phase 6: Integration & Testing (Week 3)

### Task 6.1: End-to-End Game Flow
- [ ] Create new game
- [ ] 4 players join
- [ ] Game starts (cards dealt)
- [ ] Round of play (multiple tricks)
- [ ] Card exchange
- [ ] Next round starts
- [ ] Integration test with real Supabase + API
- **Blockers**: All Phase 3-5 tasks
- **Testability**: E2E test (Cypress or Playwright)
- **Estimated**: 8 hours

### Task 6.2: Edge Cases & Error Handling
- [ ] Player disconnects/reconnects
- [ ] Invalid plays (server-side validation)
- [ ] Wild card selection
- [ ] Same-rank card selection (1-2 finish)
- [ ] Level promotion logic
- [ ] Game win condition
- **Blockers**: All Phase 3-5 tasks
- **Testability**: E2E tests + manual
- **Estimated**: 8 hours

### Task 6.3: Performance & Polish
- [ ] Animations (card plays, trick transitions)
- [ ] Connection status indicator
- [ ] Spectator list
- [ ] Game history/replay
- [ ] Mobile responsiveness
- **Blockers**: All Phase 3-5 tasks
- **Testability**: Manual + Lighthouse
- **Estimated**: 10 hours

---

## Parallelism Summary

**Week 1**:
- Tasks 1.1, 1.2, 1.3 (sequential, foundational)

**Week 2** (fully parallel):
- Tasks 2.1-2.4 (game logic, all independent)
- Tasks 3.1-3.4 (API routes, after 1.2 & 2.x done)
- Tasks 4.1-4.4 (frontend state, independent)
- Tasks 5.1-5.6 (UI components, can use mocks)

**Week 3**:
- Tasks 6.1-6.3 (integration & polish)

---

## Testing Strategy

| Task | Test Type | Coverage |
|------|-----------|----------|
| 2.1-2.4 | Unit (Jest) | 90%+ |
| 3.1-3.4 | Integration | Happy path + errors |
| 4.1-4.4 | Unit (Jest) | 80%+ |
| 5.1-5.6 | Component (RTL) | 70%+ |
| 6.1-6.3 | E2E (Cypress) | Critical flows |

---

## Dependencies Graph

```
1.1, 1.3 ──┐
           ├─→ 2.1 ─→ 2.2 ─→ 2.3 ─→ 2.4
           │
1.2 ────────┤
            ├─→ 3.1 ─→ 3.2 ─→ 3.3 ─→ 3.4
            │
            ├─→ 4.1 ─→ 4.2, 4.3 ─→ 4.4
            │
            └─→ 5.1, 5.2, 5.3, 5.4, 5.5 ─→ 5.6
                        │
                        └────→ 6.1, 6.2, 6.3
```

---

## Time Estimates

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1 | 9 hours | Sequential, foundational |
| Phase 2 | 28 hours | 100% parallelizable |
| Phase 3 | 28 hours | After Phase 1 done |
| Phase 4 | 21 hours | Parallel with Phase 3 |
| Phase 5 | 33 hours | Can use mocks during Phase 4 |
| Phase 6 | 26 hours | Integration & polish |
| **Total** | **~145 hours** | **~6 weeks solo, 2 weeks with 3 devs** |

