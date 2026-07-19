---
name: db-migration
description: "Create or change Supabase/Postgres schema for the Guandan project. Use whenever a task requires adding, altering, or dropping a table/column/index/policy — 'add a migration', 'change the schema', 'alter the games table', etc. Writes a new numbered migration file (never edits one already applied), runs a focused review of the SQL for safety and consistency with ARCHITECTURE.md, and only pushes to the remote Supabase database after the user explicitly approves — using `supabase db push` with the session-pooler URL, then verifying the remote schema matches. Triggers: 'make a migration', 'add a migration', 'apply migrations', 'update the db schema'."
metadata:
  type: project-skill
---

# DB Migration

Use whenever a task needs a schema change in `supabase/migrations/`. Three phases: **write**, **review**, **apply** — never skip straight to apply.

## 1. Check what's already applied to remote

Before writing anything, check which migrations remote already has, so you know whether you're adding a new file or (rarely, and only with explicit user confirmation) touching an unapplied one:

```bash
supabase migration list --db-url "$DATABASE_MIGRATION_URL"
```

**Never edit a migration file whose version already appears in the `remote` column.** Migrations are immutable once applied — editing one in place desyncs the repo from what actually ran on remote (and on anyone else's remote). If the change is to something already applied, write a new migration that alters the existing objects (`alter table`, `drop column`, etc.), even if that makes the history look like "create X then immediately alter X."

## 2. Write the migration

- New file: `supabase/migrations/00N_short_description.sql`, next sequential number after the highest existing file.
- Match existing conventions (see `001_initial_schema.sql`): a header comment explaining *why*, not just what; status/type-like columns stay plain `text` with validation in `src/lib/types.ts`, not CHECK constraints or enums; add indexes for new foreign keys or frequently-filtered columns; update RLS policies if the change affects a table with RLS enabled.
- Cross-check against `ARCHITECTURE.md` section 2 (schema) — if the migration changes something documented there, plan to update that doc too (see step 5).
- If the change affects `src/lib/types.ts` row interfaces or API request/response types, update those in the same pass so the PR is self-consistent.

## 3. Focused review before touching remote

Launch a focused review subagent when delegation is available; its findings gate the apply step. Give it:

- The migration SQL itself, plus `ARCHITECTURE.md` section 2 for the intended schema and any RLS/security notes in the existing migrations for context.
- An explicit request to check correctness (does the SQL do what's intended, will it actually run against the current remote schema), safety (data loss from a `drop column`/`drop table`/`not null` addition on a table that may have rows, locking behavior on large tables, missing `if exists`/`if not exists` guards where useful), and consistency (naming conventions, RLS coverage for new tables, index coverage for new foreign keys).

Relay findings in full. If they call for changes, fix the migration file and re-run this review — don't proceed to step 4 on a round that produced changes.

## 4. Confirm before applying to remote

Applying to remote is a shared, hard-to-reverse action — always get explicit user approval first, even if the review round came back clean. Show the user the migration file's contents (or a diff) and a dry run:

```bash
supabase db push --db-url "$DATABASE_MIGRATION_URL" --dry-run
```

Confirm the dry run lists only the new migration(s) you intend to apply — nothing already-applied should show up as pending (that would mean step 1 was skipped or missed something).

## 5. Apply

Once the user approves:

```bash
supabase db push --db-url "$DATABASE_MIGRATION_URL" --yes
```

**Known gotcha**: `DATABASE_MIGRATION_URL` typically points at the transaction pooler (port `6543`), which can throw `ERROR: prepared statement "..." already exists (SQLSTATE 42P05)` — a known incompatibility between the CLI and PgBouncer transaction-mode pooling. If that happens, retry with the session pooler by swapping the port to `5432`:

```bash
supabase db push --db-url "$(echo "$DATABASE_MIGRATION_URL" | sed 's/:6543/:5432/')" --yes
```

If both fail, stop and report the exact error rather than retrying blindly or falling back to a local/destructive workaround (e.g. never `supabase db reset` against remote).

## 6. Verify remote matches

```bash
supabase migration list --db-url "$DATABASE_MIGRATION_URL"
```

Confirm the new version now shows up under `remote`. For column-level changes, also spot-check via the PostgREST schema so you're verifying actual server state, not just the CLI's bookkeeping:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(list(d['definitions']['<table>']['properties'].keys()))"
```

## 7. Summarize

Report: which migration file(s) were added, what the review flagged (and how it was resolved), and confirmation that remote now matches — including the verification query output, not just "it succeeded."
