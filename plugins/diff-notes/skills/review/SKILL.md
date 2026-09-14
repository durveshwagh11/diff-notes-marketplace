---
name: review
description: Open the current git diff in a browser so the user can leave inline comments on specific lines, then read those comments back and address each one. Use when the user wants to review, annotate, or leave notes on changes you made, or runs /diff-notes:review. Optional argument is a git base (e.g. HEAD~2, main) to diff against instead of the working tree.
---

# Review the diff with inline comments

The user wants to look at the changes in the working tree and leave line-level notes on them before deciding what to do next.

## Steps

1. Run the review server. It blocks until the user clicks **Send to Claude** in the browser (or closes the tab), then prints the comments and exits:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/review-server.mjs" $ARGUMENTS
   ```

   Tell the user in one line that the review is open at the URL the script prints, and that you'll wait. Do not do anything else while it runs.

2. When the script exits, its stdout contains the comments as a markdown list, each in the form:

   ```
   - path/to/file.ts:42 (on `const total = a + b;`) — Why not use the existing sum() helper?
   ```

   If the output says `No comments.`, tell the user and stop.

3. For each comment, in file order:
   - Re-read the surrounding code before changing anything; the line number refers to the *new* side of the diff.
   - If the comment is a question, answer it briefly. Only change code if the answer implies a change.
   - If the comment asks for a change, make it with a minimal edit.
   - If you disagree, say so and explain in one or two sentences rather than silently ignoring it.

4. Finish with a short summary: one line per comment saying what you did (changed / answered / declined and why).

5. Offer to run the review again so the user can check the follow-up changes.

## Notes

- Comments are also saved at `.claude/diff-notes/comments.json` in the project. If the script fails, read that file instead.
- Never commit on the user's behalf as part of this skill.
