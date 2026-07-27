-- game_rounds row creation is moving from game-creation time to
-- POST /api/game/[id]/start (ARCHITECTURE.md section 7/8): a game no longer
-- has a round while it's still 'waiting' for players to join. The 'join'
-- action logged by join/route.ts needs somewhere to go even during that
-- window, so round_id can no longer be NOT NULL — a join logged before
-- start now uses round_id: null. Every other action type (card plays,
-- exchanges, etc.) only ever happens once a round exists, so this doesn't
-- change their behavior. The FK and its on-delete-cascade are unaffected.

alter table game_actions alter column round_id drop not null;
