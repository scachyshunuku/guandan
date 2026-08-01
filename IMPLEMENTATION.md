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
- [x] `POST /api/game/[id]/end-hand`
  - Determine finishing positions
  - Determine exchange type (1-4, 1-3, 1-2)
  - Check if game won (1-2 or 1-3 at level A)
  - Set previous round's game_rounds.status = 'completed'
  - Create new game_rounds (round N+1); shuffle & deal cards immediately
  - Determine the initial exchange (best card, cancellation) against that
    freshly-dealt hand; set the new round's status to 'card_exchange'
    (or 'awaiting_giver_choice'/'awaiting_tribute_choice' for a tie, or
    straight to 'in_progress' if cancelled)
  - Broadcast next round start (initial exchange calculated, if any)
- [x] `POST /api/game/[id]/exchange-cards`
  - Validate player received card
  - Accept card selection for return
  - Insert card_exchange actions
  - When all returns done, activate the already-dealt round:
    game_rounds.status = 'in_progress', current_player_turn = leader
  - Broadcast round activated
- [x] Integration tests: Single-team lead, two-team lead, card selection, level promotion
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
- [x] Create `hooks/useGame.ts`:
  - Combines Zustand + Realtime sync + API mutations
  - Manages optimistic updates
  - Handles reconnection
- [x] Unit tests: Sync logic, optimistic updates
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

### Task 5.1a: Drag-and-Drop Hand Rearrangement
- [x] Extend `components/game/PlayerHand.tsx` to support manual reordering:
  - Drag a card to a new position within the own-hand grid
  - Reorder is purely a client-side display preference — does not
    affect play validation, which operates on card identity, not position
  - Persist the reordered layout across re-renders triggered by
    `useGameRealtimeSync` hand updates (e.g. after playing/drawing cards,
    keep unmoved cards in their user-arranged positions rather than
    resetting to server/sorted order)
  - Persist the arrangement across page refresh and disconnect/reconnect:
    localStorage (keyed by game id + player id, ordering by stable card
    identity, not array index) for same-device instant persistence, plus a
    `game_participants.hand_order` column and `POST /api/game/[id]/hand-order`
    (debounced background sync from the client) so the arrangement also
    follows the player to a different browser/device — localStorage always
    wins when both exist, since it reflects this device's most recent state;
    the server value is only a mount-time fallback for a device with nothing
    saved locally yet
  - Keep existing click-to-select behavior working alongside drag
  - Touch support for mobile drag (not just mouse)
- [x] Unit tests: drag reorders hand array, selection state survives
  reorder, touch drag events, ordering preference survives simulated
  reload (rehydrate from storage) and reconnect, server-order fallback when
  localStorage is empty, debounced sync calls the persist callback
- [x] `POST /api/game/[id]/hand-order` route + unit tests: saves the
  caller's own order only, ownership/validation checks, never broadcasts
  (no other client needs another player's hand ordering)
- [x] `hand_order` redacted to null for every participant except the
  requesting client in `GET /api/game/[id]` (same treatment as `hand`,
  since its slot keys encode actual card identity) and in every existing
  broadcast that spreads a raw participant row (`heartbeat`, `join`)
- **Blockers**: Task 5.1
- **Enables**: None
- **Testability**: Component tests with React Testing Library
- **Estimated**: 5 hours

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
- [x] `components/game/ActionButtons.tsx`
  - Play button (enabled if valid combo selected)
  - Pass button
  - Unit tests: Button states
- [x] `components/game/CardExchangeModal.tsx`
  - Show cards to exchange (read-only initial)
  - Selection UI for return cards
  - Submit button
  - Unit tests: Modal display, selection
- [x] `components/game/WildCardSelector.tsx`
  - When playing wild card, show selector for what it acts as
  - All 13 ranks
  - All 4 suits
  - Unit tests: Selector rendering
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 7 hours

### Task 5.5: Lobby & Game Creation
- [x] `components/lobby/CreateGameForm.tsx`
  - Button to create game
  - Copy game code link
  - Unit tests: Form submission
- [x] `components/lobby/JoinGameForm.tsx`
  - Input: game code, player name
  - Submit to join
  - Unit tests: Validation, submission
- [x] `app/page.tsx` - Home page
  - Create or join game
  - Unit tests: Navigation
- **Blockers**: Task 1.3
- **Testability**: Component tests
- **Estimated**: 5 hours

### Task 5.6: Pages & Layouts
- [x] `app/layout.tsx` - Root layout with providers
  - Zustand provider
  - Supabase provider
  - Error boundary
- [x] `app/game/[id]/layout.tsx` - Game page provider
  - Initialize useGame hook
  - Pass state to children
- [x] `app/game/[id]/page.tsx` - Game board container
  - Render GameTable + PlayerHand + TrickDisplay
  - Handle game state
- [x] Unit tests: Provider setup
- **Blockers**: Tasks 4.1, 4.4, 5.1-5.4
- **Testability**: Component tests
- **Estimated**: 4 hours

---

## Phase 6: Integration & Testing (Week 3)

### Task 6.1: End-to-End Game Flow
- [x] Create new game
- [x] 4 players join
- [x] Game starts (cards dealt)
- [x] Round of play (multiple tricks)
- [x] Card exchange
- [x] Next round starts
- [x] Integration test with real Supabase + API
- **Blockers**: All Phase 3-5 tasks
- **Testability**: E2E test (Cypress or Playwright)
- **Estimated**: 8 hours

### Task 6.2: Edge Cases & Error Handling
- [x] Player disconnects/reconnects
- [x] Invalid plays (server-side validation)
- [x] Wild card selection
- [x] Same-rank card selection (1-2 finish)
- [x] Level promotion logic
- [x] Game win condition
- **Blockers**: All Phase 3-5 tasks
- **Testability**: E2E tests + manual
- **Estimated**: 8 hours

### Task 6.3: Performance & Polish
- [x] Animations (card plays, trick transitions)
- [x] Connection status indicator
- [x] Spectator list
- [x] Game history/replay
- [x] Mobile responsiveness
- **Blockers**: All Phase 3-5 tasks
- **Testability**: Manual + Lighthouse
- **Estimated**: 10 hours

---

## Phase 7: Bot Player (Dev/Test Tooling)

All-bot dev/testing mode only for v1 — no lobby UI, no mixed human+bot
seating, no disconnect-takeover. Every bot decision is trivial (lowest
legal option / pass), and every bot move runs through the same
server-side validation/persistence/broadcast code a human's request does.

### Task 7.1: Schema — Bot Seat Marker
- [x] Migration: `game_participants.is_bot boolean not null default false`
- **Blockers**: None
- **Enables**: Task 7.4
- **Testability**: Migration review (db-migration skill)
- **Estimated**: 1 hour

### Task 7.2: Extract Decision Routes into Callable Actions
- [x] `src/lib/gameActions/playCards.ts`, `pass.ts`, `chooseGiverCard.ts`,
      `chooseTribute.ts`, `exchangeCards.ts`, `endHand.ts` — same logic as
      each route today, callable directly (no HTTP) so a bot and a human
      run identical code
  - Export previously-private `lastPlayedCombo` (`gameRules/validation.ts`)
  - Export previously-private `getRoundCardExchangeActions` and add
    `pendingReturnPositions` (`gameActions/exchangeCards.ts`)
- [x] Thin each route (`play-cards`, `pass`, `choose-giver-card`,
      `choose-tribute`, `exchange-cards`, `end-hand`) down to parse → call →
      respond
- [x] Existing `route.test.ts` files pass unmodified
- **Blockers**: None
- **Enables**: Task 7.4
- **Testability**: Unit tests per extracted function
- **Estimated**: 6 hours

### Task 7.3: Bot Decision Logic
- [x] `src/lib/bot/chooseTrickAction.ts` — lead lowest single; follow with
      lowest legal single beat or pass; validated through `canPlayCards`
- [x] `src/lib/bot/chooseExchange.ts` — trivial giver/tribute/return-card
      heuristics
- **Blockers**: Task 7.2
- **Enables**: Task 7.4
- **Testability**: Unit tests
- **Estimated**: 4 hours

### Task 7.4: Bot Runner, Seeding & Dev Route — superseded, removed
- [x] `src/lib/bot/botRunner.ts` — drive bot turns by dispatching on
      `game_rounds.status`, calling the Task 7.2 actions + Task 7.3
      decisions
- ~~`src/lib/bot/seedBotMatch.ts` — create game, seat 4 bots, start, mark
      `is_bot`, reusing existing create/join/start routes in-process~~
- ~~`POST /api/game/dev/bot-match` — seeds + drives a full game,
      non-production only~~
- ~~Integration test: full bot-vs-bot game reaches `status: 'completed'`~~
- Removed once Phase 8 shipped `add-bot`/`drive-bots`: seating every
  position with a bot (via repeated `add-bot` calls) plus letting
  `drive-bots` polling run the game covers the same ground as the
  dedicated dev tool did, so the tool itself, its all-bot-only seeding
  helper, and its single-request drive-to-completion loop
  (`driveBotGame`) were deleted rather than kept as unused parallel
  paths. `driveOneBotAction` (the single-step primitive both used) is the
  only thing that remains, now Phase 8's only caller.
- **Blockers**: Tasks 7.1, 7.2, 7.3
- **Testability**: Integration test (see Phase 8 Task 8.7) + manual curl
- **Estimated**: 5 hours

---

## Phase 8: Mixed Human + Bot Play

Lets a human play alongside bot-filled seats (e.g. 1 human + 3 bots) from
the real UI, rather than the all-bot-only dev tool. Bot turns happen
automatically as the game progresses in real time, driven by a client-side
poll (same pattern as the existing end-hand auto-trigger), not resolved all
at once in one request.

### Task 8.1: Expose `is_bot` to the Client
- [x] `GameParticipant.isBot` (`src/lib/types.ts`) and `mapGameParticipantRow`
      (`src/lib/db/mappers.ts`) carry the existing `is_bot` column through to
      the client — not redacted, since which seats are bot-controlled is
      public information
- [x] Verified broadcast payloads (`participant_joined`/`participant_updated`)
      carry it through unchanged (they spread the raw DB row)
- **Blockers**: None
- **Enables**: Task 8.5
- **Testability**: Unit tests (mapper, realtime sync)
- **Estimated**: 1 hour

### Task 8.2: `POST /api/game/[id]/add-bot`
- [x] Seats one server-generated bot into the first open position, reusing
      `join`'s route in-process, then marks it `is_bot`
- [x] Only a seated player may call it, only while `game.status === 'waiting'`
- **Blockers**: Task 7.1
- **Enables**: Task 8.6
- **Testability**: Unit tests
- **Estimated**: 3 hours

### Task 8.3: Bot-Turn Dispatch Refactor
- [x] `src/lib/bot/botRunner.ts`: extracted `driveOneBotAction` (performs at
      most one bot action, reporting `acted`/`idle`/`completed`/`error` —
      "idle" i.e. "not this bot's turn" is a normal outcome, not a bug, for
      a mixed game) out of the original all-bot `driveBotGame` loop
  - Also fixed: when multiple positions are pending a giver-choice or
    card-exchange return and only some are bots, finds *a* bot among them
    rather than only ever checking the first pending position
- [x] `driveBotGame` initially preserved as a thin loop over
      `driveOneBotAction` for the Phase 7 dev tool; removed along with that
      tool once Task 8.2/8.4 made it redundant (see Task 7.4's note) —
      `driveOneBotAction` is now the module's only exported entry point
- **Blockers**: Task 7.2, Task 7.3
- **Enables**: Task 8.4
- **Testability**: Unit tests (mixed-mode "idle"/"finds a bot among
  pending" behavior; the dispatch-error-path test was ported from the
  removed `driveBotGame` test onto `driveOneBotAction` directly)
- **Estimated**: 4 hours

### Task 8.4: `POST /api/game/[id]/drive-bots`
- [x] Looks up the game's bot-seated positions and performs at most one bot
      action via `driveOneBotAction`; always 200 — "not a bot's turn" is a
      normal no-op, a genuine action failure is a 500
- **Blockers**: Task 8.3
- **Enables**: Task 8.5
- **Testability**: Unit tests
- **Estimated**: 2 hours

### Task 8.5: Client Polling
- [x] `useGame.ts`: new interval effect (mirroring the existing end-hand
      auto-trigger) polling `drive-bots` while the game is `in_progress`,
      the client is seated, and the game has any bot seat
- [x] `useGameActions.ts`: `addBot`/`driveBots` mutations
- **Blockers**: Tasks 8.1, 8.4
- **Enables**: Task 8.6
- **Testability**: Unit tests
- **Estimated**: 2 hours

### Task 8.6: UI — "Fill remaining seats with bots"
- [x] `WaitingRoom` (`src/app/game/[id]/page.tsx`): button shown once seated
      with an open seat remaining, seating one bot per open seat
- **Blockers**: Tasks 8.2, 8.5
- **Testability**: Unit tests + manual
- **Estimated**: 2 hours

### Task 8.7: Integration Test
- [x] A human's own `play-cards`/`pass`/`choose-*`/`exchange-cards` calls
      interleaved with repeated `drive-bots` calls drive a full 1-human +
      3-bot game to `status: 'completed'` — now the sole full-game bot
      integration test, since Task 7.4's dev-tool equivalent was removed
- **Blockers**: Tasks 8.2-8.6
- **Testability**: Integration test + manual curl against real Supabase
- **Estimated**: 3 hours

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

