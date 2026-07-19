# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Docs to reference

- **ARCHITECTURE.md** — how we plan to implement the system. Consult before writing or planning implementation work.
- **RULES.md** — how the Guandan game itself works. Consult before implementing any game-logic behavior.

## Workflow

For every task from `IMPLEMENTATION.md`:

1. **Read** whatever's necessary to understand what's going on — the task's checklist in `IMPLEMENTATION.md`, the relevant sections of `ARCHITECTURE.md` and `RULES.md`, and any existing related code.
2. **Implement** the task.
3. **`verify-task`** (skill) — confirms the checklist items are actually done and checks them off, runs a staff-engineer subagent review, runs unit tests, and exercises any changed UI.
4. **`open-pr`** (skill) — opens the PR with a summary, verification results, screenshots, review order, and inline annotations.

If the task requires a schema change, use the **`db-migration`** skill instead of hand-writing SQL — it writes a new migration, gets it reviewed, and only applies to remote once approved.
