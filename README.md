# diff-notes

A Claude Code plugin that lets you review Claude's changes in the browser, leave inline
comments on specific lines, and hand those comments back to the same Claude Code session.

## Install

```
/plugin marketplace add durveshwagh11/diff-notes-marketplace
/plugin install diff-notes@durvesh-plugins
```

## Use

After Claude has made some changes:

```
/diff-notes:review            # uncommitted changes vs HEAD (incl. untracked files)
/diff-notes:review HEAD~3     # everything since a commit
/diff-notes:review main       # everything on this branch
```

A browser tab opens. Click any line, type a note, save. When you're done, press
**Send to Claude**. The notes land in Claude's context and it works through them one by one.

Comments are also written to `.claude/diff-notes/comments.json`. That folder is left out of
later reviews, but you may still want to add it to `.gitignore`.

If you close the tab without sending, the session stops waiting after about 90 seconds.

## How it works

| File                                             | Role                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `scripts/review-server.mjs`                      | Runs `git diff`, serves the review page on `127.0.0.1`, waits for notes |
| `scripts/diff.mjs`                               | Parses `git diff` output into files, hunks and old/new line numbers     |
| `scripts/review.html`, `review.js`, `review.css` | The review page                                                         |
| `skills/review/SKILL.md`                         | Tells Claude how to run the review and act on the notes                 |

The server blocks until the page posts the notes to `/done`, prints them as a markdown list
and exits; Claude reads that output and works through it. Git runs without a shell, so the
diff base and file names can't inject commands, and `/done` accepts only JSON, which other
websites can't send to it.

## Requirements

Node 18+ and git. The plugin has no npm dependencies.

## Development

```
npm install          # Prettier, for development only
npm run format       # format everything
npm run check        # format check + tests (also runs in CI)
```
