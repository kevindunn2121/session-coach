# Changelog

All changes to session-coach, newest first. Pull request numbers up to #5 refer to the earlier repository `Nterlace-Solutions/session-coach`.

## 0.11.0 (2026-11-05)

- The Session coach and Setup audit panes end with a dim line showing the loaded version, such as `session-coach 0.11.0`, so after `/reload-plugins` you can tell which installed copy runs. The plugin reads the version from its own `.claude-plugin/plugin.json` at session start and when a pane opens, so the line cannot drift from the manifest.

## 0.10.0 (2026-11-05)

- A sixth fix timing, **On the side**, for expert suggestions that do read-only work, such as a review, a check, a test run or a search. **Run on the side** puts the fix in your prompt box with an instruction to run it in a background subagent, so Claude keeps working on its task. The card has no Fix with Claude, so you read the fix before you send it. The analysis model picks the timing. Only a prompt fix can have it; any other kind keeps its default timing.
- The timing rules tell the model that `/btw` answers only from the conversation and cannot read files or run commands, so it picks Side question only for questions the conversation can answer.

## 0.9.0 (2026-11-04)

- Live tips fix in one click, like setup audit cards. The "To make it stick" lines of the verify, unread-file, plan and subagent tips get **Fix**, which adds the line to `~/.claude/CLAUDE.md` under `## Session coach` with a backup and a diff, and **Undo**. The expert analysis can return the same kind of patch with a suggestion, and the plugin checks it with the same rules as the setup audit.
- **Fix with Claude** on live tips sends the fix as your prompt in one click. Put in prompt and Copy stay, so you can still edit a fix first.
- Undo survives a plugin reload and a new session. Before, the record of a fix lived only in memory, so a reload dropped the Undo button although the backup stayed on disk. The plugin now saves each fix to its store, the setup fixes with the audit fingerprint, and loads them at session start and when a pane opens.
- A fix whose card is gone keeps its Undo under **Earlier fixes you can undo**: a tip that stopped showing, a setup card marked Done, or a recommendation a new audit no longer lists. When a new audit reuses an id for a different change, the earlier fix keeps its own Undo.

## 0.8.0 (2026-11-04)

- Setup audit cards fix in one click. **Fix** applies a recommendation's patch itself: it saves a backup to `~/.claude/session-coach/backups/`, writes the file, and shows the diff and when the change takes effect. **Undo** puts the file back, unless you edited the file after the fix. When the change is already there, Fix writes nothing.
- **Fix with Claude** replaces Apply and Send to Claude. It sends the instruction as your next prompt in one click, without the prompt box, for hooks, allow rules and every change the plugin does not make itself. When Fix cannot write a file, the card says why and offers Fix with Claude.
- Patches keep each file's line ending and final newline. Before, a file without a final newline gained one.

## 0.7.4 (2026-11-04)

- The tip for a long session with no subagents now also offers a line for `~/.claude/CLAUDE.md`: delegate codebase searches and broad file reads to a subagent and keep only its summary in the main context.

## 0.7.3 (2026-11-03)

- The setup audit can return a `patch` for a recommendation the plugin can apply on its own, without Claude: lines to add to a CLAUDE.md, or `model`, a short list of `env` names, and `deny` or `ask` rules to merge into a `.claude/settings.json`. The parser drops any patch that touches hooks, allow rules or another key, so Claude still makes those changes behind its permission prompt. A new `hooks/apply.ts` plans each change, skips it when it is already there, keeps the file's indentation and line endings, and shows a line diff. The pane does not apply patches yet.

## 0.7.2 (2026-11-02)

- The guide, the line map and the transparency page share one menu, with a theme button. All three open in dark mode, and the theme you pick carries to the other pages.

## 0.7.1 (2026-11-02)

- The guide, the line map and the transparency page link to each other. Each feed refresh copies the guide into `~/.claude/session-coach/` beside the other two, so the links work there too. The docs snapshots are from the playbook of 2026-11-02.

## 0.7.0 (2026-11-02)

- A transparency page shows how the coach built its playbook and its recommendations: the sources tried, the posts kept and cut, the ranking, the posts behind each practice, and every rule with its trigger. Every feed refresh writes it to `~/.claude/session-coach/playbook-transparency.html`, and `/coach transparency` writes it now. The playbook model now cites the numbered posts behind each practice and tool, and feeds keep each post's link. The line map and the pane link to the page.
- The first setup audit runs at the first session start, before any session history exists, and judges your setup from a new `profile` option: by default an AI application and data engineer on Snowflake, Azure containers, Snowpark Container Services and GitHub. The audit also sees the names of stack files, such as `dbt_project.yml`, `Dockerfile` and GitHub Actions workflows. Expert analysis reads the profile too, and a profile change starts a new audit.
- Feed posts are ranked by age as well as score. Posts from the last 7 days count in full, older posts halve each week, and the playbook model sees each post's age.
- The Hermes inbox and the `inboxFile` option are removed. The coach always fetches its own feeds.
- A `.claude-plugin/plugin.json` manifest that declares every option, and a `marketplace.json` for a local install.
- macOS: tests use POSIX paths, and the pane uses `bold` instead of `weight`, which Claude Code 2.1.296 refuses.

- Documentation: a new README layout, this changelog, and a CLAUDE.md for agents that work on the repository.
- Documentation: an updated source-curator guide in `overview.md`, and a new line map snapshot from the playbook of 2026-10-29.

## 2026-10-27

- The coach writes the playbook line map again after every playbook build, and on `/coach map`, to `~/.claude/session-coach/playbook-line-map.html`. The playbook model gives each practice and tool a station. (#5)
- A playbook line map in `docs/playbook-line-map.html`, also published as an artifact. It starts with a first prompt for any new project and runs through seven stations and two always-on lines. Every recommendation and setup card shows its station and links to it. A new `playbookUrl` option sets the link. (#4)

## 2026-10-25

- Recommendations are ranked P1 to P4 and tagged with a category. Rule tips and expert suggestions share one list. The pane is split into colored sections: Now, Recommendations, Vitals, Score, and Setup & feed. Setup cards are ranked the same way, and the band shows the priority of the top item. (#3)
- Each fix has a timing: a `/btw` side question, now while Claude works, as the next prompt, after Esc, or after the session. After Put in prompt, the status line says what to press, based on whether Claude is working. (#2)
- Each recommendation has an exact fix that says where the change goes and what to do next. Each fix has Put in prompt and Copy buttons, and the pane has Copy report. In the desktop app, Copy falls back to the prompt box and Copy report to a file. (#1)

## 2026-10-24

- Each coach job uses its own pinned model: Claude Sonnet 5.5 for the playbook, expert analysis and setup audit, and Claude Haiku 5.5 at low effort for the turn judge.
- The setup audit reads your CLAUDE.md files, settings, agents, skills, plugins and MCP servers, and proposes changes with their effect on drift and token cost. Apply fills the prompt box, with Send to Claude and Copy as the fallback.
- Vitals: plan usage, coach cost, cache hit rate, context runway, git state, permission asks and file churn, each with tips.
- Button results show at the top of the pane, because toasts do not show in the desktop app.

## 2026-10-16

- The playbook can come from a Hermes inbox file, which a daily Hermes cron job writes. While the inbox is less than 26 hours old, the coach does not fetch the web itself.
- A turn judge gives a verdict after every turn. The pane shows a score trail and the verdict history, and it opens at session start.
- First version: live metrics, the score, rule tips, and the expert playbook from Reddit, blogs and X.
- First version: expert analysis, the band, the pane, the `/coach` commands and the session report.
