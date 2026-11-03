# Changelog

All changes to session-coach, newest first. Pull request numbers up to #5 refer to the earlier repository `Nterlace-Solutions/session-coach`.

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
