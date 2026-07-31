-- Task 5.1a (IMPLEMENTATION.md): lets a player drag-reorder their own hand
-- and have that arrangement survive refresh/reconnect from any device.
-- Stores the player's preferred display order as an array of card-identity
-- strings (e.g. "7H#0" - rank+suit code plus an occurrence sequence number,
-- since a double deck can hold two physically identical cards). This is
-- purely a display preference, never authoritative game state: it's
-- reconciled against the real `hand` column on every read (see
-- lib/cardUtils.ts / components/game/PlayerHand.tsx reconcileOrder), so a
-- stale or entirely absent value just falls back to natural/dealt order -
-- nothing ever trusts it as the source of truth for which cards a player
-- holds. Same access rules as `hand`: no RLS policy, so only the service
-- role (Next.js API routes) can read or write it.

alter table game_participants add column hand_order jsonb;
