# session-coach

A Claude Code plugin that coaches you while you work with Claude. It scores each session live and judges every turn. It compares your work and your setup with practices that top AI engineers share. Each recommendation gets a priority, a category, a playbook station and an exact fix.

## Contents

- [Install](#install)
- [The coach pane](#the-coach-pane)
- [Recommendations](#recommendations)
- [Live score and vitals](#live-score-and-vitals)
- [Turn judge and expert analysis](#turn-judge-and-expert-analysis)
- [Setup audit](#setup-audit)
- [Expert playbook and line map](#expert-playbook-and-line-map)
- [Transparency page](#transparency-page)
- [Commands](#commands)
- [Options](#options)
- [Models and cost](#models-and-cost)
- [Privacy](#privacy)
- [Desktop app notes](#desktop-app-notes)
- [Files](#files)
- [Develop](#develop)

## Install

To install from a local folder, for example this OneDrive copy on macOS, add the folder as a marketplace and install from it. The plugin is then read from the folder itself, so an edit reaches your sessions after `/reload-plugins`:

```bash
claude plugin marketplace add "$HOME/Library/CloudStorage/OneDrive-TRIMEDXHoldings,LLC/Apps/SessionCoach"
```

```bash
claude plugin install session-coach@session-coach
```

To try it in one terminal session without installing, run `claude --plugin-dir <folder>`.

To install from GitHub, use the public repository `kevindunn2121/session-coach`.

In a Claude Code terminal session:

```text
/plugin install session-coach --marketplace kevindunn2121/session-coach
```

From a shell:

```bash
claude plugin install session-coach --marketplace kevindunn2121/session-coach
```

In the desktop app, click + next to the prompt box, then Plugins. Add the marketplace `kevindunn2121/session-coach`, then add the plugin.

After an update, run `/reload-plugins` or start a new session. The plugin needs Claude Code 2.1.29x or newer, because the plugin hooks API is early access.

## The coach pane

When a session starts, the pane opens. It has these sections, each in its own colored box:

| Section | What it shows |
| --- | --- |
| Buttons | Analyze now, Refresh feed, Setup audit and Copy report. |
| Status line | The result of the last button press, for example "1 new suggestion" or what to press after Put in prompt. |
| Now | The latest turn verdict, colored by verdict, with the next prompt to send, the score trail and the last 20 verdicts. |
| Recommendations | Rule tips and expert suggestions in one list, most important first. |
| Vitals | Plan usage, cache hit rate, context runway, git state, permission asks, file churn and the coach's own cost. |
| Score | The five score parts as bars, with turn and tool counts. |
| Setup & feed | Open setup recommendations, the feed status, and links to the playbook line map and the transparency page. |

A band above the prompt shows the score, the verdict, plan usage from 60% and the top recommendation with its priority. Details opens the pane. Hide hides the band.

## Recommendations

Each recommendation is a card with four labels and a fix.

Priority sets the order:

| Priority | Color | Meaning |
| --- | --- | --- |
| P1 Critical | Red | It causes failures, data risk or wasted work now. |
| P2 High | Orange | It costs tokens or quality in every session. |
| P3 Medium | Yellow | A clear improvement. |
| P4 Low | Blue | Nice to have. |

The category is one of Safety, Tokens & cost, Quality, Context, Workflow, Git or Setup.

The station is the part of the playbook line map that the advice belongs to, for example "3 Plan" or "5 Verify". The card links to that station.

The source is "rule" for a built-in rule or "expert" for a suggestion from the analysis model.

The fix says where the change goes and what to do next:

| Fix kind | Example |
| --- | --- |
| Prompt | Add this to your next prompt: "Run the tests now and show me the real output." |
| CLAUDE.md | Update `~/.claude/CLAUDE.md` with a line. Then start a new Claude session. |
| Settings | Update `~/.claude/settings.json`. Then start a new session. If Claude asks, approve the hook in `/hooks`. |
| File | Edit a named file. |
| Command | Run this in Claude: `/compact keep the current task, the files changed so far, and the open decisions`. |
| Action | A step you do by hand. |

Some tips also have a second fix, labeled "To make it stick", that adds a permanent rule to your `~/.claude/CLAUDE.md`, under a `## Session coach` heading.

Each fix also has a timing, because Claude can be in the middle of a turn:

| Timing | When |
| --- | --- |
| Side question | Now. It goes in as `/btw`, so Claude answers without changing its task. `/btw` answers only from the conversation so far: it cannot read files or run commands. |
| On the side | Now. Claude hands the work to a background subagent and keeps working on its task. The expert analysis picks this for read-only work, such as a review, a check, a test run or a search. |
| Steer now | Now. Press Enter, and Claude reads it before its next step. |
| Next prompt | After Claude finishes the current turn. |
| Stop first | Press Esc to stop Claude, then send it, because continuing wastes work. |
| After this session | When Claude is idle or after the session. Then start a new session. |

The buttons on each fix:

1. Fix makes the change in one click, the same way as on a setup audit card. The "To make it stick" lines of the verify, unread-file, plan and subagent tips have it, and so does an expert suggestion when the analysis model returns a patch the plugin can write itself. The plugin saves a backup to `~/.claude/session-coach/backups/` first, and the card shows the diff.
2. Undo puts the file back, unless you edited it after the fix. When the tip stops showing, the fix moves to **Earlier fixes you can undo** at the bottom of the recommendations, so Undo stays.
3. Fix with Claude sends the fix to Claude as your prompt, in one click and without the prompt box. Fixes without a patch have it, except steps you do by hand. A fix with a patch has it only when the plugin cannot write the file.
4. Put in prompt puts the fix in your prompt box, so you can edit it first, and the status line says what to press, based on whether Claude is working. On an "On the side" fix, this button is called **Run on the side**. It adds the instruction to run the fix in a background subagent, and the card has no Fix with Claude, so you read the fix before you send it.
5. Copy copies the fix. In the desktop app, Copy puts the text in the prompt box instead (see [Desktop app notes](#desktop-app-notes)).

The plugin keeps a record of each fix in its store, so Undo still works after a plugin reload or in a new session.

## Live score and vitals

The coach measures every prompt, tool call and turn without model calls. It scores the session out of 100 in five parts of 20 points each:

| Part | What it measures |
| --- | --- |
| Context | Prompts that name files and state what done looks like, minus vague prompts. |
| Verification | Runs of tests, linters and type tools per edit, minus untested edits that pile up. |
| Discipline | Files read before they are edited, and a plan step before big changes. |
| `Leverage` | Subagents, skills, research and plan mode. |
| Efficiency | Failed and repeated commands, correction prompts, denials and context fill. |

The vitals:

| Vital | What it shows | Tip |
| --- | --- | --- |
| Plan usage | Your 5-hour and 7-day windows, with the reset time of each. | P2 at 80%, P1 at 95%. |
| Cache hit rate | Cache reads as a share of all input tokens. | P2 below 50% after 5 turns. |
| Context runway | How full the context is, and how many turns are left before auto-compaction. | P1 at 3 turns or fewer. |
| Git | Branch, changed files, lines changed and time since the last commit. | P2 for work on `main` or a big diff, P3 for a stale last commit. |
| Permission asks | How many tool calls needed your approval. | P4 at 8 or more. |
| File churn | The most-edited file. | P1 at 5 or more edits to one file. |
| Coach cost | The coach's own model calls and tokens, as a share of all tokens. | None. |

Other rule tips cover repeated failed commands and 5 or more edits without a test. They also cover correction prompts, edits to unread files and vague prompts. Two more cover big changes with no plan and long sessions with no subagents. Each tip shows once as a toast in the terminal.

## Turn judge and expert analysis

After every turn, the judge model gives a verdict: on track, drifting, stuck or blocked. It gives one line on why. For a session that is off track, it also gives the exact next prompt to paste, with its timing. A bad verdict also shows as a toast in the terminal.

Every 3 turns, the analysis model compares the session with the expert playbook. Press Analyze now to run it at once. It gives up to 4 suggestions, each with a priority, category, station and exact fix. Suggestions can be habits, or skills, agents, hooks or commands to add.

## Setup audit

The setup audit compares your setup with what your sessions do and with the expert playbook. It reads these files and names:

- your global and project `CLAUDE.md` files.
- both `settings.json` files: hooks, permissions, model, and the names of environment variables, never their values.
- your skills, agents, plugins and MCP server names.

Each card shows the problem, the evidence and the change. It also shows a fix you can do by hand, and the effect on drift and token cost for each choice: apply or skip. Cards are sorted by priority.

The buttons on each card:

1. Fix makes the change in one click, when the plugin can make it itself: lines added to a `CLAUDE.md`, or `model`, a short list of `env` settings, and `deny` or `ask` rules merged into a `.claude/settings.json`. The plugin saves the file to `~/.claude/session-coach/backups/` first, and the card shows the diff and when the change takes effect. If the change is already there, nothing is written.
2. Undo puts the file back. If you edited the file after the fix, Undo leaves it alone and tells you where the backup is. Undo survives a plugin reload and a new session. When a new audit no longer lists a fix you made, or you mark its card Done, the fix moves to **Earlier fixes you can undo** at the bottom of the pane.
3. Fix with Claude sends the instruction to Claude as your next prompt, in one click, for every other change: hooks, allow rules, skills, agents, MCP servers and new files. Claude makes the change under your normal permission prompts. If Fix cannot write a file, for example a `settings.json` that is not valid JSON, the card says why and offers Fix with Claude.
4. Copy copies the instruction, and Skip hides the card until your setup files change.

The first audit runs a few seconds after the coach's first session starts, before you send a prompt. With no session history yet, it judges your setup on its own, from the point of view in the `profile` option and against the playbook. The default profile is an AI application and data engineer on Snowflake, Azure containers, Snowpark Container Services and GitHub. The audit also sees the names, never the contents, of project files that show the stack, such as `dbt_project.yml`, `snowflake.yml`, `Dockerfile` and `.github/workflows/*`. Expert analysis reads the same profile.

The audit runs once a day. A change to your setup files or to `profile` also starts an audit. Run `/coach setup refresh` to run it now.

## Expert playbook and line map

Once a day, the coach builds the expert playbook. The playbook model turns recent posts by AI engineers into up to 12 practices and 8 tool ideas, and gives each one a station. A built-in seed playbook is used until the first build succeeds.

The posts come from these sources, in order:

1. The coach's own fetches: subreddits through RSS, expert blogs, and X through any RSS mirrors you set.
2. Posts you saved with `/coach paste`.

The coach removes duplicate titles, then ranks posts by score and age. A post from the last 7 days counts in full, and its weight halves for each further week. A post with no date counts half, and a pasted post counts as new. Each post goes to the playbook model with its age, and the model sees posts until it reaches 24,000 characters.

X has no free API. The public Nitter and XCancel mirrors were down at the time of writing. By default, X content comes from `/coach paste` and from the same engineers' blogs. To read X directly, set `xMirrors` to a self-hosted Nitter or RSSHub template, for example `https://your-nitter.example/{handle}/rss`. Reddit's JSON API returns 403 to anonymous clients, so the coach uses each subreddit's RSS feed.

The playbook line map draws the playbook as a project line map. Station 1 is a copyable first prompt for any new project: the goal and done-when criteria, a plan before code, the agents, testing and git. Stations 2 to 7 are Set up, Plan, Build, Verify, Ship and Learn. Two lines run the whole time: Context & cost, and Safety.

The map exists in three places:

| Copy | Updated |
| --- | --- |
| `~/.claude/session-coach/playbook-line-map.html` | After every playbook build. `/coach map` also updates it. |
| [`docs/playbook-line-map.html`](docs/playbook-line-map.html) | A snapshot, updated by hand. |
| The published artifact at the `playbookUrl` link | A snapshot, updated by hand. Every recommendation links here. |

## Transparency page

The transparency page shows how the coach came to its advice. Every feed refresh writes it again to `~/.claude/session-coach/playbook-transparency.html`, including a refresh that fails, and `/coach transparency` writes it now. It has five steps:

1. Read: every source the coach tried, with the posts each one gave, kept after duplicates were removed, and sent to the model. A source that gave nothing says so, and X accounts with no mirror are listed as not read.
2. Rank: the ranking formula, `(1 + log2(1 + score)) × recency`, and the recency rules.
3. Cut: how much of the 24,000-character limit the posts used, and each post the model saw, numbered as in its prompt, with its link, age, score, recency weight and rank.
4. Distill: each practice and tool with the post numbers that back it. The playbook model cites them, and a number that names no post it saw is dropped. An item with no citation is marked as the model's own synthesis.
5. Recommend: the three lanes that turn the playbook into advice (rule tips, expert suggestions and the setup audit), every built-in rule with its trigger, priority, category, station and fix timing, the ranking rules the models follow, and how the list is ordered.

Post titles come from public feeds. Pasted posts appear on the page too, so check them before you share the file. [`docs/playbook-transparency.html`](docs/playbook-transparency.html) is a snapshot from the built-in seed playbook, updated by hand.

## Commands

| Command | What it does |
| --- | --- |
| `/coach` | Open the pane. |
| `/coach analyze` | Compare the session with the playbook now. |
| `/coach refresh` | Build the playbook from the feeds now. |
| `/coach paste <text>` | Save an X post or any expert tip as a playbook source. |
| `/coach setup` | Open the setup audit. Add `refresh` to run a new audit. |
| `/coach report` | Print the session report in the chat, where you can select and copy it. |
| `/coach map` | Write the line map from the current playbook and print its path. |
| `/coach transparency` | Write the transparency page from the current playbook and print its path. |
| `/coach hide` and `/coach show` | Hide or show the band. |

## Options

Set the options with `/plugin configure session-coach@session-coach` in a terminal session, or under `pluginConfigs.session-coach` in your settings.

| Option | Default | What it does |
| --- | --- | --- |
| `profile` | An AI application and data engineer on Snowflake, Azure containers, Snowpark Container Services and GitHub | The role and stack that the setup audit and expert analysis advise. |
| `subreddits` | `ClaudeAI,ClaudeCode,ChatGPTCoding,LocalLLaMA,AI_Agents` | Subreddits for the coach's own fetches. |
| `xHandles` | `bcherny,_catwu,alexalbert__,karpathy,swyx,simonw,HamelHusain,eugeneyan` | X accounts to read through mirrors. |
| `xMirrors` | empty | RSS URL templates for X, with `{handle}`. |
| `extraFeeds` | seven expert blogs | RSS or Atom feeds of expert blogs. |
| `judgeTurns` | `true` | Judge every turn. |
| `openPane` | `auto` | `auto` opens the pane at session start. `command` opens it only from `/coach` or Details. |
| `playbookUrl` | empty, which means the published line map | Where recommendations link for their station. |
| `analyzeEvery` | `3` | Turns between expert analyses. `0` turns automatic analysis off. |
| `playbookModel` | `claude-sonnet-5-5` | The model that builds the playbook. |
| `analysisModel` | `claude-sonnet-5-5` | The model for expert analysis and the setup audit. |
| `judgeModel` | `claude-haiku-5-5` | The model for the turn judge. |
| `obsidianDir` | empty | A folder to write the session report to at the end of each session, for example `~/Documents/Obsidian/Claude Coach`. |

## Models and cost

| Job | Model | Effort | How often |
| --- | --- | --- | --- |
| Turn judge | Claude Haiku 5.5 | low | Every turn |
| Expert analysis | Claude Sonnet 5.5 | medium | Every 3 turns, and on Analyze now |
| Setup audit | Claude Sonnet 5.5 | medium | Daily, plus each setup file change |
| Playbook build | Claude Sonnet 5.5 | medium | Once a day, and on `/coach refresh` |

The Claude calls go through your own Claude Code session, so they count toward your Claude plan's usage. The Vitals section shows the coach's share of all tokens.

## Privacy

The coach's models receive the metric summary and excerpts of your last six prompts, each up to 280 characters. The judge also receives the last prompt and the first 800 characters of Claude's answer. The setup audit receives your instruction files, with secret-looking values masked, and a summary of your settings. These calls go through your own Claude Code session. Nothing else leaves the machine except the feed fetches.

## Desktop app notes

The coach works in the Claude desktop app, with these differences from a terminal session:

- Toasts do not show. Button results show in the status line at the top of the pane instead.
- Plugins cannot write to the clipboard. Copy puts the text in your prompt box for you to copy, and Copy report saves the report to `~/.claude/session-coach/export.md`.
- Fix and Fix with Claude on a setup card or a tip do not use the prompt box, so they work the same in the desktop app.
- `/plugin` does not run in the desktop app. Use + next to the prompt box, then Plugins.

## Files

| Path | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | The manifest and the options. |
| `.claude-plugin/marketplace.json` | Makes the folder a marketplace, for a local install. |
| `hooks/register.tsx` | The hooks module: events, state, commands and the pane, band and setup pane. |
| `hooks/metrics.ts` | Metrics, the score and the rule tips. |
| `hooks/vitals.ts` | Plan usage, git, coach cost and their tips. |
| `hooks/judge.ts` | The turn judge prompt and verdicts. |
| `hooks/coach.ts` | The expert analysis prompt and the session report. |
| `hooks/setup.ts` | The setup snapshot, secret masking and the setup audit. |
| `hooks/feed.ts` | Feed fetching, recency ranking and the playbook build. |
| `hooks/fix.ts` | Fix kinds, timings and their text. |
| `hooks/rank.ts` | Priorities, categories, stations and ranking. |
| `hooks/map.ts` | The line map renderer. |
| `hooks/transparency.ts` | The transparency page renderer. |
| `types/index.d.ts` | Shared types and the plugin state contract. |
| `tests/` | Tests for `claude plugin test`. |
| `docs/playbook-line-map.html` | The published line map snapshot. |
| `docs/playbook-transparency.html` | A transparency page snapshot, from the built-in seed playbook. |
| `docs/session-coach-guide.html` | A how-to guide for using the coach. |
| `CLAUDE.md` | Notes for agents that work on this repository. |
| `CHANGELOG.md` | Changes by release. |

## Develop

Run these commands from the repository root:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx -y -p typescript@5.6.3 tsc -p .
```

To load your working copy in one session, run:

```bash
claude --plugin-dir .
```

A plugin installed from a local folder marketplace reads from that folder, so saved changes reach your sessions after `/reload-plugins`.

`tsc` needs the engine's type declarations in `.claude-plugin/types/`, which is gitignored. The engine writes that folder when it loads the plugin with `--plugin-dir`. [CLAUDE.md](CLAUDE.md) lists the plugin API rules and the git workflow for this repository.
