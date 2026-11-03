# session-coach: notes for agents

This repository is a Claude Code plugin built on the plugin hooks API. Read [README.md](README.md) for what the plugin does. This file lists the rules that changes to the plugin often break.

## Commands

Run these from the repository root after every change:

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .
```

The installed plugin runs from a cached copy in `~/.claude/plugins/cache/session-coach/session-coach/<version>/`, not from this folder, even though `claude plugin list` says "Read from" this folder. The cache refreshes only when the version changes. To try a change in a live session, bump `version` in `.claude-plugin/plugin.json`, run `claude plugin update session-coach@session-coach`, then `/reload-plugins` or start a new session.

`tsc` needs the engine's type declarations in `.claude-plugin/types/`. That folder is gitignored. The engine writes it each time it loads the plugin. To lay it, start a session with `claude --plugin-dir .` once. In a new worktree, copy it from the main checkout.

## Plugin API rules

- You can pass `$` only to functions that are declared at the top level of a file. A closure inside `register` that receives `$` fails validation.
- A hooks module and its tests cannot use a dynamic `import()`. Use import declarations.
- A render hook must not write state. Write state from a button handler or from another event.
- Keep values that the pane draws in `$.state`, and declare each one in `types/index.d.ts`. Module variables reset at each plugin reload.
- In tests, the hooks that the test registers answer calls on `$` with `{ value: ... }`. Events, such as `turn.complete` or `prompt.fill`, return their own result shape.
- A test registers every hook before it calls `$` for the first time.
- Toasts do not show in the desktop app, and plugins cannot write to its clipboard. Show results in the pane's status line instead.
- `$.prompt.fill` can hang in the desktop app. Always race it against a timeout, as `fillPrompt` does.

## Where things live

- Rule tips: `hooks/metrics.ts` (`tips`) and `hooks/vitals.ts` (`vitalTips`). Each tip needs a fix, a timing, a priority, a category and a station. Set them in the `TIP_WHEN` and `TIP_RANK` tables.
- Model prompts: `hooks/judge.ts`, `hooks/coach.ts`, `hooks/setup.ts` and `hooks/feed.ts`. The setup audit and expert analysis take the `profile` option, the developer's role and stack. If you change a JSON shape, update its parser and its tests.
- Fix text and timings: `hooks/fix.ts`. Ranking, categories and stations: `hooks/rank.ts`.
- The transparency page: `hooks/transparency.ts` renders it from the playbook, the trail that `buildTrail` in `hooks/feed.ts` records, and the rule catalogs (`RULE_CATALOG` in `hooks/metrics.ts`, `VITAL_CATALOG` in `hooks/vitals.ts`). When you add or change a rule tip, update its trigger text in `TIP_TRIGGER` or `VITAL_RULES`.
- The shared menu: `hooks/nav.ts` holds the page file names, the menu, its style and the theme script. The map and the transparency page render it. `docs/session-coach-guide.html` is not generated, so after a menu change, paste the new `NAV_STYLE` and `siteNav('guide')` output into it. All three pages default to `data-theme="dark"`.
- The line map: `hooks/map.ts` renders it. `docs/playbook-line-map.html` is a snapshot. Keep the station anchors (`#start` to `#learn`, `#context`, `#safety`), because every recommendation links to them.

## Git

Follow the git rules in the user's global CLAUDE.md:

1. Run `git fetch --all --prune` and `gh pr list --state open` before you start.
2. Cut a branch from `origin/main` in its own worktree in a sibling `session-coach-worktrees/` folder.
3. Open a draft PR after the first commit.
4. Merge with squash after `gh pr checks` and a review of your own diff. The repository has no CI yet, so report that `gh pr checks` shows no checks.
5. Pull `main` in the folder that the installed plugin reads from. `claude plugin list` shows it.

Tests run on macOS and Windows, so use POSIX paths such as `/Users/kevin` in mocked file and env values. On Windows, Python heredocs in Git Bash collapse backslashes, so write patch scripts and test files with a file-writing tool instead.
