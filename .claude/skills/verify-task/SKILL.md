---
name: verify-task
description: "Verify a completed Guandan implementation task before it ships. Use when a task from IMPLEMENTATION.md is believed complete and needs checking off, when asked to 'verify' or 'check' a task, or before opening a PR (open-pr assumes this has already run). Confirms every checklist sub-item is actually implemented (not just believed to be), kicks off a staff-engineer-style subagent review for architecture soundness, reusable/duplicated logic, and unhandled bugs/edge cases, runs the full unit test suite, exercises any changed UI with agent-browser (uploading screenshots via gh-image for reuse in the PR), and exercises any changed API routes with real curl requests (saving request/response pairs for reuse in the PR) — looping fixes back through the subagent review until everything passes cleanly. Triggers: 'verify this task', 'is task X done', 'check off IMPLEMENTATION.md', 'ready for review'."
metadata:
  type: project-skill
---

# Verify Task

Run this after implementation work on a Guandan task looks finished, before checking it off in `IMPLEMENTATION.md` or handing off to the `open-pr` skill.

## 1. Identify the task in scope

Determine which `IMPLEMENTATION.md` task(s) this covers — from the user's message, the current branch name, or `git diff origin/main...HEAD --stat`. If ambiguous, ask rather than guessing.

## 2. Confirm every checklist item is actually done

Read the task's section in `IMPLEMENTATION.md`, plus the relevant parts of `ARCHITECTURE.md` (how it's supposed to be built) and `RULES.md` (the game behavior it must satisfy). For each `- [ ]` sub-item, open the actual file(s) it refers to and confirm the behavior exists in code — prior conversation or memory is not proof.

- Every sub-item confirmed → check it off (`- [x]`) with an Edit to `IMPLEMENTATION.md`.
- Any sub-item missing or incomplete → do **not** check it off. Report the gap to the user and stop; don't continue to step 3 for an incomplete task.

## 3. Staff-engineer subagent review

Launch a subagent (Agent tool, run in the foreground since its findings gate the rest of this skill) with:

- The exact files changed: `git diff origin/main...HEAD --name-only`
- `ARCHITECTURE.md` and `RULES.md` for the intended design and game rules
- Explicit framing: review as a staff engineer weighing tradeoffs — is this the right architecture for the problem, not just "does it work"? Where would a staff engineer push back?
- A specific ask: find reusable or duplicated logic in this diff (and against existing code elsewhere in the repo) worth consolidating.
- A specific ask: look for bugs or edge cases that aren't handled — invalid/malformed input, empty hands, wild-card edge cases, concurrent plays, boundary conditions in scoring/level promotion — anything the happy-path tests wouldn't catch.

Relay its findings to the user in full — don't silently accept or silently drop them. If the findings call for code changes, make them now, then **restart this step** — re-run the subagent review against the updated diff before moving on. Only proceed to step 4 once a review round comes back with nothing to fix.

## 4. Run the unit test suite

Run the full suite (check `package.json` → `scripts.test` for the exact command), not just tests for the new code. If anything fails and requires a code fix, make the fix, then **go back to step 3** — a fresh subagent review must see the updated code before tests are re-run. Don't check off the task or proceed on a round that produced changes.

## 5. Exercise changed UI with agent-browser

If the task touched anything under `app/`, `components/`, or other UI code, use agent-browser to drive the actual changed flow — click through the interaction, not just load the page — and capture screenshots of it working.

**No page wires up the component yet** (common for Phase 5 component tasks built ahead of the pages that consume them, e.g. `Card.tsx` before `app/game/[id]/page.tsx` exists): create a temporary route (e.g. `app/_dev-preview/page.tsx`) that renders the component(s) with representative props/state so there's something to screenshot. Use it for the agent-browser pass, then **delete the temp route before this step ends** — `git status` should show no trace of it once you're done. Never let a scaffolding page reach step 3's review, the test suite, or the eventual PR diff.

Upload each screenshot immediately with `gh image <file>` (installed extension — `gh extension list` to confirm) to get a permanent `https://github.com/user-attachments/assets/...` URL; don't leave this for later, local screenshot files aren't guaranteed to survive to the `open-pr` step. Write the resulting markdown embeds to `.context/verify-task-screenshots/<task-slug>.md` (e.g. `task-2-2.md`), **overwriting** any previous version of that file — only the final clean round's screenshots should remain. `open-pr` reads this file instead of re-capturing.

If agent-browser isn't available in this environment, say so explicitly and fall back to the `run` skill for manual verification. Don't report a UI task as verified without one or the other. If this step surfaces a bug requiring a code fix, apply it and **go back to step 3**, same as step 4 — the stale screenshots file from the failed round will get overwritten on the next pass through this step, and a temp preview route (if used) needs to be recreated on the next pass through this step and deleted again before moving on.

## 6. Exercise changed API routes with real requests

If the task added or changed anything under `app/api/**/route.ts` (or any other API endpoint), don't rely on unit tests alone — start the app (or use an already-running dev server) and fire real HTTP requests at each changed endpoint with `curl`, covering both the happy path and at least one error case (invalid combo, wrong turn, malformed body, etc. — whatever's relevant to that endpoint).

For each request, record the exact request (method, path, headers if non-default, body) and the exact response (status, body) into `.context/verify-task-api/<task-slug>.md` (e.g. `task-3-2.md`), **overwriting** any previous version — only the final clean round's request/response pairs should remain. `open-pr` reads this file to paste real examples into the PR description.

If a request reveals a bug requiring a code fix, apply it and **go back to step 3**, same as steps 4 and 5.

## 7. Repeat until clean

Steps 3-6 form a loop: any code change made because of a review finding, a test failure, a UI bug, or an API bug sends you back to step 3. Only exit the loop when a full pass through steps 3, 4, 5, and 6 produces zero code changes.

## 8. Summarize

Report: which checklist items were confirmed/checked off, how many review-fix cycles it took, final test results, UI verification result, API verification result, and the subagent's last-round architecture/reuse findings. Only call the task "verified" if steps 2-7 all came back clean.
