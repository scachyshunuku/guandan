-- IMPLEMENTATION.md Phase 7 (Bot Player): distinguishes a server-seeded bot
-- participant from a human one. Nothing in application code reads this back
-- yet -- the all-bot dev/test game runner (src/lib/bot/) already knows its
-- own bot seats in-memory from seeding them -- this exists so the schema
-- truthfully describes what a row is, and as groundwork for a later mixed
-- human+bot lobby feature. Same plain-boolean style as `is_connected`, no
-- CHECK/enum. No index: at most 4 rows per game.

alter table game_participants add column is_bot boolean not null default false;
