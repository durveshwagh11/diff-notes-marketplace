# diff-notes

A Claude Code plugin that lets you review Claude's changes in the browser, leave inline
comments on specific lines, and hand those comments back to the same Claude Code session.

## Install

```
/plugin marketplace add https://github.com/durveshwagh11/diff-notes-marketplace
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

Comments are also written to `.claude/diff-notes/comments.json` (add that folder to
`.gitignore`).

## Requirements

Node 18+ and git. No npm dependencies.
