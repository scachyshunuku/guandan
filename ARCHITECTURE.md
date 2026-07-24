# Guandan Multiplayer Card Game - Architecture Plan

A real-time multiplayer Guandan card game using Supabase and Vercel. Private games with shareable links. Guests only—no user accounts.

## 1. Tech Stack & Deployment

**Frontend:**
- **Framework**: Next.js 14+ (React with App Router)
- **UI**: Shadcn/ui + Tailwind CSS
- **State Management**: Zustand (local game state)
- **Real-time**: Supabase Realtime (WebSocket-based)
- **HTTP Client**: TanStack Query for server state

**Backend:**
- **Primary**: Supabase (PostgreSQL + Realtime + Storage)
- **API Routes**: Next.js API routes for validation
- **Hosting**: Vercel

**Key Decision**: Supabase Realtime instead of separate Socket.io server for simplicity and lower operational overhead.

---

## 2. Database Schema

### Core Tables

```sql
games (overall game state)
├── id (UUID, PK) -- game code/ID (shareable)
├── status (TEXT: 'waiting', 'in_progress', 'completed'; validated in app code)
├── team_a_level (INT) -- current level for team A (2-14, where 14=Ace)
├── team_b_level (INT) -- current level for team B (2-14)
├── winning_team (INT) -- 0 (team A) or 1 (team B), null if in_progress
├── created_at
└── updated_at

game_rounds (per-round state, one per hand)
├── id (UUID, PK)
├── game_id (UUID, FK -> games.id)
├── round_number (INT) -- 1st hand, 2nd hand, etc.
├── game_state (JSONB) -- {playedCards: {}, playedThisTrick: {...}, trickCount: int, ...}
├── current_player_turn (INT: 0-3) -- whose turn it is
├── leader_position (INT: 0-3) -- who led current trick
├── status (TEXT: 'in_progress', 'card_exchange', 'completed'; validated in app code)
├── finishing_positions (INT[]) -- [p0_finish, p1_finish, p2_finish, p3_finish] e.g. [1, 4, 2, 3]
├── created_at
└── updated_at

game_participants
├── id (UUID, PK)
├── game_id (UUID, FK -> games.id)
├── player_name (VARCHAR)
├── player_id (VARCHAR) -- session-based ID (generated per connection)
├── position (INT: 0-3, or null if spectator) -- position in game
├── hand (JSONB[]) -- array of {suit: string, rank: string} objects
├── is_connected (BOOLEAN)
├── connected_at
├── last_heartbeat
└── created_at

game_actions (event log)
├── id (UUID, PK)
├── game_id (UUID, FK -> games.id)
├── round_id (UUID, FK -> game_rounds.id)
├── player_id (VARCHAR)
├── action_type (TEXT: 'card_played', 'pass', 'card_exchange', 'join', 'leave'; validated in app code)
├── action_data (JSONB) -- varies by action_type:
│                         --   card_played: {cards: [{suit, rank}, ...], position: int}
│                         --   card_exchange: {from: int, to: int, card: {suit, rank}, type: 'initial'|'return'}
├── created_at (with microseconds for ordering)
```

### Card Representation

Cards are objects with string suit and rank:
```json
{
  "suit": "CLUBS|HEARTS|SPADES|DIAMONDS",
  "rank": "2|3|4|5|6|7|8|9|10|JACK|QUEEN|KING|ACE|BLACK_JOKER|RED_JOKER"
}
```

### Notes on JSONB / Array Columns

- **hand** (JSONB[]): Array of card objects `{suit, rank}` for each player's current cards.
- **game_state** (JSONB in game_rounds): Current trick state:
  ```json
  {
    "currentTrick": [
      {"position": 0, "play": [{"suit": "CLUBS", "rank": "ACE"}]},
      {"position": 1, "play": "PASS"},
      {"position": 2, "play": [{"suit": "HEARTS", "rank": "KING"}]}
    ]
  }
  ```
  Entries are in turn order starting from the trick leader (`leader_position`), one per action taken so far; a player who hasn't acted yet simply has no entry. Each entry records its own `position` explicitly rather than leaving it to be derived from `(leader_position + n) % 4`: once a player has gone out mid-round they take no further turns, and if the trick winner has gone out their partner leads next instead of the next seat in line (RULES.md "Leader Selection") — either of which means a trick's rotation doesn't necessarily visit every position in seat order, so the index can't be trusted to recover who acted. `"play": "PASS"` = passed, card array = played.
- **action_data** (JSONB in game_actions): Flexible structure for different action types:
  - card_played: `{cards: [{suit, rank}, ...]}`
  - pass: `{}`
  - card_exchange: `{from: int, to: int, card: {suit, rank}, type: 'initial'|'return'}`

### Key Design Decisions

1. **No User Table**: `player_name` is just a string, no persistent identity
2. **Session-based IDs**: `player_id` is a temporary ID generated per connection (UUID or nanoid)
3. **Position Encoding**: 0-3 for active players; `NULL` for spectators
4. **Spectator Model**: More than 4 people can join; extras become spectators
5. **Game Code**: No separate short code — the game's UUID `id` is itself the shareable code used in URLs and invite links

### Indexes

```sql
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_game_rounds_game_id ON game_rounds(game_id);
CREATE INDEX idx_game_participants_game_id ON game_participants(game_id);
CREATE INDEX idx_game_actions_game_id_created_at ON game_actions(game_id, created_at);
CREATE INDEX idx_game_actions_round_id ON game_actions(round_id);
```

---

## 3. Game Logic Architecture

**Hybrid Model**: Client-side optimistic updates + server-side validation

```
CLIENT SIDE (Optimistic)      SERVER SIDE (Authoritative)
├─ UI Rendering                ├─ Game Rule Validation
├─ Hand Management             ├─ State Consistency Check
├─ Drag-Drop Interactions      ├─ Turn Management
├─ Optimistic Updates          ├─ Conflict Resolution
├─ Input Validation            ├─ Score Calculation
├─ Animation Sequencing        ├─ Move Persistence
└─ TanStack Query Sync         └─ Broadcasting
```

### Game Logic Layers

**Layer 1: Card Validation Rules** (`lib/gameRules.ts`)
```
├─ getCardRank(card) → number (for comparison)
├─ isValidCombination(cards) → {valid: bool, type: string} (single, pair, triple, full house, straight, tube, plate, bomb)
├─ canPlayCombination(combination, hand, leadCombination) → {valid: bool, reason: string}
├─ isHigherCombination(combo1, combo2, levelRank, currentLevel) → boolean
├─ calculateTrickWinner(playedCombos, leadPosition) → winnerId
├─ getCardValue(card, levelRank) → number (for ranking, considering wild hearts)
└─ validateMove(combination, playerHand, gameState) → {valid: bool, reason: string}
```
Used by both client (UX) and server (validation). See RULES.md for combination types and card ranking.

**Layer 2: Game State Management** (`app/api/game/[code]/actions.ts`)
- `POST /api/game/[code]/play-cards` — Validate move, persist, broadcast
- `POST /api/game/[code]/join` — Add participant, assign position or spectator
- `POST /api/game/[code]/leave` — Remove participant, reassign positions if needed
- `GET /api/game/[code]/state` — Get current game state

**Layer 3: Real-time Synchronization** (`lib/realtimeSync.ts`)
- Subscribe to Supabase channel: `games:[code]`
- Handle broadcasts: `card_played`, `player_joined`, `player_left`, `trick_complete`, `game_state_updated`
- Conflict resolution: server state always wins

---

## 4. Real-time Synchronization & Disconnect Handling

### Event Flow

```
Player 1                 Supabase                    Player 2
  │                         │                           │
  ├─ Plays cards            │                           │
  │  (optimistic UI)        │                           │
  │                         │                           │
  ├─ POST /api/game/play    │                           │
  │────────────────────────>│                           │
  │                         ├─ Validate                 │
  │                         ├─ Persist to game_actions  │
  │                         ├─ Update games.game_state  │
  │                         ├─ REALTIME BROADCAST       │
  │                         │                           │
  │ <─────────ACK────────── │                           │
  │ (matches local state)   │                           │
  │                         ├───────── BROADCAST ──────>│
  │                         │   "card_played" event     │
  │                         │                           │
  │                         │                    Update hand
  │                         │                    UI sync
```

### Disconnect & Reconnect

1. **Detection**:
   - Client stops sending heartbeats → server marks `is_connected = false` after 30s
   - UI shows "Player X disconnected" for other players

2. **Reconnection**:
   - Player refreshes or reconnects → `POST /api/game/[code]/rejoin`
   - Server updates `is_connected = true`
   - Return full game state + unconfirmed moves
   - Broadcast "Player X reconnected"

3. **Spectator Join/Leave**:
   - No impact on game flow
   - When spectator count ≥ 2, show spectator list in UI
   - Old spectators can take active player's spot if they disconnect

---

## 5. Participant & Spectator Management

### Joining Flow

```
Guest enters name & game code
  ↓
POST /api/game/[code]/join { playerName, playerId }
  ↓
[Server Check: How many active players (position != null)?]
  ├─ If < 4: Assign position (0-3), return { position, hand }
  └─ If ≥ 4: Mark as spectator (position = null), return { spectator: true }
  ↓
Broadcast via Realtime: "player_joined"
  ↓
All clients update their view (show new player, or add to spectator list)
```

### Position Assignment

When player joins:
- Assign first available position (0-3)
- If all positions filled, add as spectator
- If active player disconnects, spectators can take their spot (optional: auto-assign closest spectator)

### Leaving / Disconnection

When player leaves or disconnects:
- If active player: move them to "away" state temporarily
- After 5 minutes: remove participant, reassign positions if needed
- Broadcast "player_left"

---

## 6. Frontend Architecture

### Component Structure

```
src/
├── app/
│   ├── layout.tsx (Root with Providers)
│   ├── page.tsx (Home/Create/Join)
│   ├── game/
│   │   └── [code]/
│   │       ├── layout.tsx (Game provider)
│   │       ├── page.tsx (Game container)
│   │       ├── waiting.tsx (Waiting for players)
│   │       └── spectate.tsx (Spectator view)
│   └── join/
│       └── [code]/page.tsx (Join game by code)
│
├── components/
│   ├── game/
│   │   ├── GameTable.tsx (Main board)
│   │   ├── PlayerHand.tsx (Your cards + drag-drop)
│   │   ├── TricksDisplay.tsx (Recent tricks)
│   │   ├── PlayerCard.tsx (Each player bubble)
│   │   ├── SpectatorList.tsx (List of spectators)
│   │   ├── TrumpDisplay.tsx (Current trump info)
│   │   ├── ScoreBoard.tsx (Team scores)
│   │   └── ChatPanel.tsx (Quick chat/signals)
│   │
│   ├── lobby/
│   │   ├── CreateGameForm.tsx (Start new game)
│   │   ├── JoinGameForm.tsx (Enter code + name)
│   │   └── ShareLink.tsx (Copy/share link)
│   │
│   └── shared/
│       ├── Card.tsx (Single card visual)
│       ├── ConnectionStatus.tsx
│       └── Spinner.tsx
│
├── hooks/
│   ├── useGame.ts (Main game state hook)
│   ├── useGameRealtimeSync.ts (Supabase subscription)
│   ├── usePlayerHand.ts (Card management)
│   └── useGameActions.ts (API mutations)
│
├── lib/
│   ├── gameRules.ts (Shared validation)
│   ├── cardUtils.ts (Card encoding, sorting)
│   ├── supabase.ts (Client)
│   ├── realtimeSync.ts (Subscription logic)
│   └── types.ts (Shared TypeScript types)
│
├── store/
│   ├── gameStore.ts (Zustand - local game state)
│   └── uiStore.ts (Zustand - modals, animations)
│
└── api/
    └── game/
        └── [code]/
            ├── join.ts (POST join game)
            ├── leave.ts (POST leave game)
            ├── play-cards.ts (POST validate + save move)
            ├── declare-trump.ts (POST trump update)
            ├── state.ts (GET current state)
            └── actions.ts (GET action history)
```

### State Management

```ts
// Zustand store (lib/store/gameStore.ts)
export const useGameStore = create<GameState>((set) => ({
  // Game meta
  gameCode: null,
  gameStatus: 'waiting',
  
  // Participants
  participants: [], // { playerId, playerName, position, hand, isConnected }
  myPlayerId: null,
  myPosition: null,
  spectators: [],
  
  // Game state
  hand: [], // array of {suit, rank}
  playedCards: {}, // { playerPosition: [{suit, rank}, ...] }
  currentPlayerTurn: -1,
  tricks: [],
  scores: [0, 0], // [teamA, teamB]
  
  // Mutations
  setHand: (cards) => set({ hand: cards }),
  playCards: (cardsToPlay) => set(state => ({
    hand: state.hand.filter(c => !cardsToPlay.includes(c)),
  })),
  updateGameState: (newState) => set(newState),
}));

// Real-time sync hook
useEffect(() => {
  const subscription = supabase
    .channel(`games:${gameId}`)
    .on('postgres_changes', 
      { event: 'UPDATE', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        useGameStore.setState({ gameState: payload.new.game_state });
      }
    )
    .on('broadcast', { event: 'card_played' }, (payload) => {
      // Handle animation
    })
    .subscribe();
}, [gameId]);
```

---

## 7. Game Flow

### Create Game
1. User clicks "Create Game"
2. `POST /api/game/create` → creates `games` row with status='waiting'; the row's UUID `id` (generated by the DB) is the game code
3. Redirect to `/game/[code]`
4. User enters name → `POST /api/game/[code]/join` → becomes player position 0 (the first open seat)
5. User can copy/share link: `https://guandan.app/join/[code]`

### Join Game
1. Guest clicks invite link or enters code
2. Prompts for player name
3. `POST /api/game/[code]/join { playerName }`
4. Server checks if positions 0-3 available
   - If yes: assign position, add to `game_participants`
   - If no: add as spectator
5. Broadcast "player_joined" via Realtime
6. Show game board (if active player) or spectator view

### Start Game
1. When 4 players ready (all positions filled): "Start Game" button appears
2. User clicks "Start"
3. `POST /api/game/[code]/start`
4. Server:
   - Changes status to 'in_progress'
   - Shuffles all 108 cards (2 standard decks + 4 jokers)
   - Deals 27 cards to each player
   - Randomly selects a leader for the first round
   - Sets team levels to 2 (starting level)
   - Creates first game_round record
   - Broadcasts game start with each player's hand
5. First hand begins with randomly selected leader

### Play Combination
1. Player selects card(s) from hand to form a valid combination (single, pair, triple, straight, bomb, etc.)
2. Client validates combination type and if it beats the lead
3. If valid, optimistic update: remove from hand, show in center
4. `POST /api/game/[code]/play-cards { cards: [...] }`
5. Server validates:
   - Is it a valid combination?
   - Does it beat the lead combination (or is it a higher bomb)?
   - Is it the player's turn?
   - If valid: persist to `game_actions`, update `games.game_state`, broadcast
   - If invalid: return error, client reverts optimistic update
6. Realtime broadcasts new game state to all players

### Pass
1. Player clicks "Pass" instead of playing
2. `POST /api/game/[code]/pass`
3. Server increments pass counter
4. Move to next player
5. If 3 consecutive players pass, trick ends and last player wins

### End Trick
1. Three consecutive players have passed (or all players passed but last played)
2. Server determines trick winner (player who played last card(s))
3. Winner leads next trick
4. Reset pass counter
5. If any player is out of cards, move to hand completion check

### End Hand / Level
1. One or more players have played all 27 cards
2. Determine finishing positions:
   - Who finished 1st (all cards played)?
   - Who finished 2nd?
   - Who finished 3rd?
   - Who finished 4th?
3. Calculate level promotions based on finishing position
4. **Card Exchange Phase** (visible to all players):
   - **Initial exchange** (automatic):
     - **Single-team lead (1-3 or 1-4 finish)**: 4th place's best card → 1st place
     - **Two-team lead (1-2 finish)**: 3rd and 4th place's best cards → 1st and 2nd place (higher rank to 1st; if tied, 1st chooses)
   - **Return exchange** (player selection):
     - Players who received cards select any card from their hand to give back to the player who gave them the card
     - All return exchanges happen simultaneously (all players choose at same time)
5. Reshuffle and deal 27 cards to each player for the next round
6. Start next hand with whoever gave up the tribute card that went to 1st
   place as leader (RULES.md "Leader Selection") — 4th place in a
   single-team lead; whichever of 3rd/4th gave the higher card in a
   two-team lead. If the tribute was cancelled (both Red Jokers held by
   the losing side), 1st place leads instead
7. Continue until a team wins with 1-2 or 1-3 finish at level A

### End Game
- Team A or B achieves 1-2 or 1-3 finish at level A (Ace)
- Broadcast game end with winning team
- Show results screen with option to play again

---

## 8. API Routes

### `POST /api/game/create`
Create a new game. Does not assign a position — the creator joins via `/join`
like anyone else once they've entered a name.
```
Response: { gameId }
```

### `POST /api/game/[code]/join`
Join an existing game.
```
Body: { playerName, playerId }
Response: { spectator: false, position, hand } OR { spectator: true }
```

### `POST /api/game/[code]/leave`
Leave the game (remove from participants).
```
Body: { playerId }
Response: { success }
```

### `POST /api/game/[code]/start`
Start the game once all 4 seats are filled (shuffle, deal 27 cards each,
pick a random leader, set status='in_progress'). Any seated player may
trigger it.
```
Body: { playerId }
Response: { success, hand }
```

### `POST /api/game/[code]/play-cards`
Play a combination of cards (with server-side validation).
```
Body: { cards: [{suit, rank}, ...], playerId, position }
Response: { success } OR { error, reason }
```

### `POST /api/game/[code]/pass`
Pass the current trick.
```
Body: { playerId, position }
Response: { success }
```

### `POST /api/game/[code]/exchange-cards`
Submit card exchange during the exchange phase (initial or return).
```
Body: { playerId, position, cardToGive: {suit, rank}, type: 'initial'|'return', recipientPosition: int }
Response: { success } OR { error, reason }
```
Note: Initial exchanges are automatic (best card). Return exchanges require player selection of which card to give back.

### `GET /api/game/[code]/state`
Get current game state (used on initial load & reconnect).
```
Response: { game, participants, myHand, gameState }
```

### `GET /api/game/[code]/actions`
Get action history (for replay/audit).
```
Response: { actions: [...] }
```

---

## 9. Key Implementation Files

### Database & Migrations
- `/supabase/migrations/001_initial_schema.sql` — Tables, indexes, RLS policies

### Shared Logic
- `/lib/gameRules.ts` — Card validation, trick calculation, scoring
- `/lib/types.ts` — TypeScript interfaces (Game, Participant, Card, GameState)
- `/lib/cardUtils.ts` — Card encoding, sorting, ranking
- `/lib/supabase.ts` — Supabase client init

### API Routes (Server Validation)
- `/app/api/game/create.ts`
- `/app/api/game/[code]/join.ts`
- `/app/api/game/[code]/start.ts`
- `/app/api/game/[code]/play-cards.ts` — Validate combination, persist, check trick/hand end
- `/app/api/game/[code]/pass.ts` — Handle pass action, check if trick ends (3 consecutive passes)
- `/app/api/game/[code]/exchange-cards.ts` — Handle card exchanges after round ends
- `/app/api/game/[code]/state.ts`

### Real-time & State Management
- `/hooks/useGameRealtimeSync.ts` — Subscribe to Supabase, handle broadcasts
- `/lib/realtimeSync.ts` — Event handlers, conflict resolution
- `/store/gameStore.ts` — Zustand store
- `/hooks/useGame.ts` — Main game hook combining state + sync

### Components
- `/components/game/GameTable.tsx` — Main board
- `/components/game/PlayerHand.tsx` — Cards + drag-drop
- `/components/game/SpectatorList.tsx` — List of spectators
- `/components/lobby/CreateGameForm.tsx` — Create game
- `/components/lobby/JoinGameForm.tsx` — Join with code + name
- `/app/game/[code]/page.tsx` — Game container
- `/app/page.tsx` — Home

---

## 10. Real-time Channels

All players in a game subscribe to the channel: `games:[code]` (implemented
in `hooks/useGameRealtimeSync.ts`, Task 4.2).

Everything is delivered via **`broadcast`**, not `postgres_changes` —
`postgres_changes` requires each table to be added to the
`supabase_realtime` publication, a manual per-project setup step this app
doesn't assume is done, so API routes explicitly broadcast after every write
instead (via `lib/realtimeBroadcast.ts`'s `broadcastToGame(gameId, event,
payload)`, which uses `channel.httpSend` — a REST call, no `subscribe()`
handshake needed for a one-off server-side send). This also sidesteps having
to reason about the `game_participants`/`game_actions` RLS policies (see the
migration's "Row-Level Security" section) for real-time delivery, since
`broadcast` doesn't go through table RLS at all — the API route decides
exactly what's in the payload (e.g. never a player's hand).

### Broadcast events

- `game_updated`, payload = the updated `games` row — sent after any write
  to `games` (currently: `POST /api/game/[id]/start` flipping `status` to
  `in_progress`). Synced to `gameStatus`/`teamLevels` in the store.
- `round_updated`, payload = the updated `game_rounds` row — sent after any
  write to `game_rounds` (currently: `start`, setting `leader_position`/
  `current_player_turn`). Synced to `currentTrick`/`currentPlayerTurn`.
- `participant_joined`, payload = the new `game_participants` row, `hand`
  always forced to `[]` regardless of the row's actual value (defense in
  depth — a fresh join always has an empty hand anyway, but this is
  player-identifying data going out unscoped, so it's never trusted to the
  DB value) — sent by `POST /api/game/[id]/join` on a genuine new join (not
  the idempotent-rejoin path, which returns early and announces nothing new).
  Synced via `addParticipant` in the store, which upserts by id rather than
  blindly appending, since a rejoin after a brief disconnect reuses the same
  participant id.
- `game_action`, payload = the inserted `game_actions` row — sent by
  whichever route inserts one (`play-cards`, `pass`, `exchange-cards` —
  Tasks 3.2/3.3, not yet implemented; `join` inserts a `game_actions` row
  too but broadcasts `participant_joined` instead, not this). No store field
  holds raw action history, so `useGameRealtimeSync` forwards the mapped
  `GameAction` to an `onGameAction` callback instead of syncing it directly.

No `participant_left` event: there's no `leave` route, or disconnect/
heartbeat detection, anywhere in the codebase yet — that's
IMPLEMENTATION.md Task 6.2 ("Player disconnects/reconnects"), still blocked
on all of Phase 3-5. Real-time participant sync currently only covers joins.

As of Task 4.2, `start` sends `game_updated`/`round_updated` and `join`
sends `participant_joined`; `game_action` remains a contract Tasks 3.2/3.3
must satisfy.

---

## 11. Spectator Features

- View all player hands (spectator only, not visible during play for active players)
- See trick history
- See scores & current trump
- Chat/emojis to cheer (optional)
- Can take active player's spot if they disconnect

---

## 12. Implementation Roadmap

### Week 1-2: Foundation
- [ ] Set up Next.js + Supabase + Vercel
- [ ] Database schema + migrations
- [ ] Basic pages: home, join, create

### Week 2-3: Core Game Loop
- [ ] Zustand store setup
- [ ] GameTable component + 4 player positions
- [ ] PlayerHand component + simple rendering
- [ ] Supabase Realtime subscriptions
- [ ] Join/leave logic

### Week 3-4: Card Play & Validation
- [ ] Card play API route with validation
- [ ] Drag-drop mechanics
- [ ] Tricks calculation & display
- [ ] Scoring

### Week 4-5: Game Flow
- [ ] Deal & shuffle logic
- [ ] Trump declaration
- [ ] Turn management
- [ ] Game start/end flows
- [ ] Disconnect/reconnect handling

### Week 5-6: Polish & Testing
- [ ] Animations (cards, tricks, etc.)
- [ ] Spectator view
- [ ] Error handling & user feedback
- [ ] Manual testing with 4+ players
- [ ] Deploy to Vercel

---

## 13. Trade-offs & Risks

| Decision | Choice | Trade-off | Mitigation |
|----------|--------|-----------|-----------|
| **No Auth** | Guest names only | No persistence, anyone can claim a name | Session-based IDs, can add auth later |
| **Spectators** | Unlimited viewers | Realtime bandwidth scales with viewers | Broadcast to all, cache for latecomers |
| **Supabase Realtime** | Managed WebSocket | Lock-in to Supabase | Alternative: add Socket.io later, low effort |
| **Hybrid Validation** | Client + server | Slight latency | Acceptable for card games (turn-based) |
| **JSONB State** | Denormalized | Less queryable | Fine for game-specific logic, not used for analytics |

---

## 14. Security Considerations

1. **SQL Injection**: Use Supabase parameterized queries only
2. **Cheating**: Server validates all moves; client-only logic for UX
3. **Disconnect Timeout**: Remove player after 5 min inactivity; spectators indefinitely
4. **RLS (Row-Level Security)**: Restrict players to their own game data
5. **Rate Limiting**: Max 1 move per 0.5s per player
6. **Move Logging**: Append-only `game_actions` table for audit trail

---

## 15. Performance Targets

- Single move latency: <200ms (P95)
- Real-time broadcast: <100ms
- Initial state load: <500ms
- Card animations: 60 FPS
- Bundle size: <300KB (gzip)

---

## 16. Cost Estimation (Monthly)

| Service | Cost | Notes |
|---------|------|-------|
| Supabase (Starter) | $25 | 500MB storage, 2GB bandwidth |
| Vercel (Pro) | $20 | For API rate limits & edge functions |
| Domain (optional) | $12 | guandan.app or similar |
| **Total** | **~$57** | Can stay on free tier initially |

---

## Summary

A simple, real-time multiplayer card game where:
- Players join via shareable game codes
- 4 players play, unlimited spectators
- Guest-based (no auth, just enter a name)
- Server-authoritative with client-side optimism
- Powered by Supabase + Vercel

Ready to start building? Let's begin with the database schema and project scaffolding.
