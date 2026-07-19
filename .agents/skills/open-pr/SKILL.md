---
name: open-pr
description: "Open a PR for a completed Guandan implementation task. Use after verify-task has passed, or when the user asks to 'open a PR' / 'ship this task'. Writes a description with the task number, a summary of what was implemented, a verification summary (tests + focused review), a suggested file review order, UI screenshots and API request/response examples reused from the verify-task session (or captured fresh if missing) — then follows up with inline GitHub review comments annotating the harder-to-follow sections of the diff."
metadata:
  type: project-skill
---

# Open PR

Use once a task is implemented and verified.

## 1. Confirm verification happened

If `verify-task` wasn't run earlier in this conversation, run it first — or explicitly tell the user you're skipping it and why. Don't open a PR for unverified work silently.

## 2. Gather PR content

- **Task number**: which `IMPLEMENTATION.md` task(s) this PR closes (e.g. "Task 2.2: Combination Validation").
- **Summary**: 2-4 sentences on what was implemented and why, grounded in the actual diff — `git diff origin/main...HEAD` and `git log origin/main..HEAD`.
- **Verification summary**: test results and the focused review's key findings from `verify-task`.

## 3. Screenshots for UI changes

If the task touched UI, don't re-capture anything — `verify-task` step 5 already drove the changed flow with agent-browser and uploaded the results. Read `.context/verify-task-screenshots/<task-slug>.md` and drop its markdown embeds (`![name](https://github.com/user-attachments/assets/...)`) straight into the PR description's Screenshots section.

If that file doesn't exist (e.g. `verify-task` was skipped, or ran before this session), capture it now: use agent-browser to drive the changed flow and take screenshots, then upload with the `gh-image` extension (installed — `gh extension list` to confirm):

```bash
gh image screenshot1.png screenshot2.png
```

Each line printed back is a ready-to-paste markdown embed. If `gh-image` is ever missing (`gh extension install drogers0/gh-image` to reinstall), fall back to scripting agent-browser: open a PR/issue comment box (any comment box on the repo works), paste/drop the screenshot file to trigger GitHub's native upload, then scrape the resulting `user-attachments` URL out of the textarea without submitting that comment.

## 4. Request/response examples for API changes

If the task touched API routes, don't re-run anything — `verify-task` step 6 already exercised the real endpoints and saved the results. Read `.context/verify-task-api/<task-slug>.md` and paste its request/response pairs into an "API Examples" section in the PR description (fenced code blocks, one pair per endpoint/case).

If that file doesn't exist (e.g. `verify-task` was skipped, or ran before this session), exercise the changed endpoints now with `curl` — happy path plus at least one error case — and record the same request/response detail before writing the section.

## 5. Suggested review order

Add a "How to review this PR" section listing files in the order a reviewer should read them to build context efficiently — e.g. types/schema first, then core logic, then call sites, then UI/API routes. Base the order on actual dependency direction in the diff, not alphabetical or file-tree order.

## 6. Create the PR

Confirm with the user before pushing and creating the PR — this is a shared, visible action.

```bash
git push -u origin <branch>
gh pr create --title "Task X.Y: <short title>" --body "$(cat <<'EOF'
## Task
Task X.Y: <name> (IMPLEMENTATION.md)

## Summary
<2-4 sentences>

## Verification
- [x] All IMPLEMENTATION.md checklist items confirmed
- [x] Unit tests passing
- [ ] UI verified via agent-browser (screenshots below) — omit if no UI change
- [ ] API verified via real requests (examples below) — omit if no API change
- [x] Staff-engineer review: <one-line takeaway>

## Screenshots
<if applicable>

## API Examples
<if applicable>

## How to review this PR
1. <file> — <why start here>
2. ...

🤖 Generated with Codex
EOF
)"
```

## 7. Inline annotations

Identify the 2-5 hardest-to-follow sections of the diff (non-obvious algorithms, wild-card logic, tricky edge cases) and post inline review comments explaining the *why*, not the *what*. Batch them as one review via the GitHub API (`{owner}`/`{repo}` auto-resolve to the current repo with `gh api`):

```bash
gh api repos/{owner}/{repo}/pulls/<number>/reviews \
  -f event=COMMENT \
  -f body='' \
  -F 'comments[][path]=lib/gameRules/validation.ts' \
  -F 'comments[][line]=42' \
  -F 'comments[][body]=<why this is non-obvious>'
```

For multiple comments, build the JSON body directly (`gh api --input -` with a heredoc) rather than repeating `-F comments[]...` flags. These are your own annotations for reviewers, not replies to existing feedback — keep them short and focused on what genuinely isn't obvious from the code alone.

## 8. Report back

Give the user the PR URL and a one-line summary of what got posted: description sections, screenshot count, API example count, inline comment count.
