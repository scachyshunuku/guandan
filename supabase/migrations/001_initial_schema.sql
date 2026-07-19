-- Initial schema for Guandan multiplayer card game.
-- See ARCHITECTURE.md section 2 for the design this implements.
--
-- Status/type-like columns are plain `text`, not Postgres ENUMs, and carry
-- no CHECK constraints. The set of valid values is enforced in application
-- code (src/lib/types.ts) rather than the database.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table games (
  id uuid primary key default gen_random_uuid(),
  code varchar(6) not null unique, -- shareable game code used in URLs (e.g. /game/[code])
  status text not null default 'waiting', -- 'waiting' | 'in_progress' | 'completed'
  team_a_level int not null default 2, -- 2..14, 14 = Ace
  team_b_level int not null default 2,
  winning_team int, -- 0 = team A, 1 = team B; null while in progress
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round_number int not null,
  game_state jsonb not null default '{}'::jsonb, -- { currentTrick: [...], trickCount, ... }
  current_player_turn int,
  leader_position int,
  status text not null default 'in_progress', -- 'in_progress' | 'card_exchange' | 'completed'
  finishing_positions int[], -- e.g. [1, 4, 2, 3], one entry per player position
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, round_number)
);

-- Participant-visible metadata only. Deliberately excludes each player's hand
-- so that this table can be safely read (directly or via Realtime) by the
-- anon client without leaking other players' cards. See RLS policies below.
create table game_participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_name varchar not null,
  player_id varchar not null, -- session-based id generated per connection
  position int, -- null = spectator
  hand jsonb not null default '[]'::jsonb, -- array of {suit, rank} card objects; never exposed to anon, see RLS
  is_connected boolean not null default true,
  connected_at timestamptz not null default now(),
  last_heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (game_id, player_id),
  unique (game_id, position) -- deferrable not needed: position reassignment happens via update, one at a time
);

-- Append-only event log, used for trick resolution, replay, and audit.
create table game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round_id uuid not null references game_rounds(id) on delete cascade,
  player_id varchar not null,
  action_type text not null, -- 'card_played' | 'pass' | 'card_exchange' | 'join' | 'leave'
  action_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp() -- clock_timestamp(), not now(), so ordering is correct within a transaction
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index idx_games_status on games(status);
create index idx_game_rounds_game_id on game_rounds(game_id);
create index idx_game_participants_game_id on game_participants(game_id);
create index idx_game_actions_game_id_created_at on game_actions(game_id, created_at);
create index idx_game_actions_round_id on game_actions(round_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger games_set_updated_at
  before update on games
  for each row execute function set_updated_at();

create trigger game_rounds_set_updated_at
  before update on game_rounds
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
--
-- This app is server-authoritative (see ARCHITECTURE.md section 3): all
-- writes happen through Next.js API routes using the Supabase service role
-- key, which bypasses RLS entirely. The policies below only govern what the
-- browser can read directly with the anon key (for the initial page load and
-- for `postgres_changes` Realtime subscriptions).
--
-- `games` and `game_rounds` hold no player-secret data (current trick state
-- is public information), so they're readable by anyone with the game's
-- code. `game_participants` and `game_actions` are NOT readable directly by
-- anon, because `game_participants.hand` and `game_actions.action_data`
-- (card_played payloads) can reveal a player's hand; that data reaches
-- clients via API responses (scoped to the requesting player) and Realtime
-- `broadcast` events (not `postgres_changes`), which the server controls.
-- ---------------------------------------------------------------------------

alter table games enable row level security;
alter table game_rounds enable row level security;
alter table game_participants enable row level security;
alter table game_actions enable row level security;

create policy "games are publicly readable"
  on games for select
  to anon, authenticated
  using (true);

create policy "game_rounds are publicly readable"
  on game_rounds for select
  to anon, authenticated
  using (true);

-- No policies for game_participants / game_actions: RLS defaults to deny,
-- so only the service role (which bypasses RLS) can read or write them.
