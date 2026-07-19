-- `games.id` (a UUID) doubles as the shareable game code used in URLs; a
-- separate short code column is unnecessary. See ARCHITECTURE.md section 2.

alter table games drop column code;
