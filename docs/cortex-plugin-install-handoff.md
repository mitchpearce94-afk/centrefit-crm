# Cortex Plugin Install Handoff — April 6, 2026

Sage installed several repos, skills, and plugins. Some are fully done, some need finishing. Here's what's left.

---

## DONE — No Action Needed

### Superpowers (global + vault)
- 14 skills installed to `~/.claude/skills/` and `Cortex-Brain/.claude/skills/`
- SessionStart hook wired in `~/.claude/hooks/` — injects using-superpowers context every session
- code-reviewer agent installed to `~/.claude/agents/`
- Verify: run `ls ~/.claude/skills/` — should see 14 folders including brainstorming, writing-plans, verification-before-completion, etc.

### GSD Principles (CLAUDE.md)
- Three principles added to both `C:\Users\mitch\Projects\Cortex\CLAUDE.md` and `C:\Users\mitch\.claude\CLAUDE.md`
- Goal-backward verification, scope reduction prohibition, CONTEXT.md before planning
- Verify: `grep "GSD" ~/.claude/CLAUDE.md`

### Obsidian-skills (vault)
- 5 skills in `Cortex-Brain/.claude/skills/`: obsidian-markdown, obsidian-bases, json-canvas, obsidian-cli, defuddle
- defuddle v0.15.0 installed globally via npm
- Verify: `ls "C:\Users\mitch\Projects\Cortex\Cortex-Brain\.claude\skills\"` — should show all 5

### AutoResearch (global + vault)
- Skill and 10 slash commands installed to both `~/.claude/skills/autoresearch/` and `Cortex-Brain/.claude/skills/autoresearch/`
- Commands installed to `~/.claude/commands/` and `Cortex-Brain/.claude/commands/`
- Available commands: `/autoresearch`, `/autoresearch:plan`, `/autoresearch:debug`, `/autoresearch:fix`, `/autoresearch:security`, `/autoresearch:ship`, `/autoresearch:scenario`, `/autoresearch:predict`, `/autoresearch:learn`, `/autoresearch:reason`
- Verify: `ls ~/.claude/skills/autoresearch/` and try `/autoresearch` in a session

### Claude-skills / alirezarezvani (global + vault)
- 69 skills cherry-picked and installed to `~/.claude/skills/` and `Cortex-Brain/.claude/skills/`
- Categories: marketing (25), engineering (28), business/growth (4), product (4), C-level advisory (5), finance (2)
- Skipped: cloud-specific (AWS/Azure/GCP), mobile, compliance/regulatory, irrelevant languages
- Verify: `ls ~/.claude/skills/ | wc -l` — should be 90+ total (14 superpowers + 5 obsidian + 1 autoresearch + 69 claude-skills + others)

### Permission Fix (settings.json)
- All tools pre-approved in `~/.claude/settings.json`, `Cortex/.claude/settings.json`, and `velocity-ai/.claude/settings.json`
- 21 tool patterns: Bash(*), Read, Write, Edit, MultiEdit, Glob, Grep, LS, WebFetch, WebSearch, Task, Agent, NotebookEdit, TodoWrite, TodoRead, mcp__obsidian__*, mcp__scheduled-tasks__*, mcp__dispatch__*, mcp__Claude_Preview__*, mcp__Claude_in_Chrome__*, mcp__mcp-registry__*
- Scheduled tasks should never stall on permissions again
- Verify: `cat ~/.claude/settings.json` and check allowedTools array

---

## NEEDS FINISHING

### 1. Claude-mem (thedotmack) — Verify hooks are chained correctly
**Status:** Installed. Plugin files at `~/.claude/plugins/marketplaces/thedotmack/`. Worker runs on port 37777. Hooks wired for SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd.

**What to check:**
- Confirm hooks in `~/.claude/settings.json` are properly chained — claude-mem hooks should run ALONGSIDE superpowers SessionStart hook, not replace it
- Start a fresh session and verify:
  - SessionStart injects both superpowers context AND claude-mem context
  - PostToolUse observations are being captured (check `~/.claude-mem/` for new data)
  - Stop event triggers session summarization
- If hooks conflict or only one fires, merge them in `~/.claude/hooks/hooks.json` so both run
- Test: `curl http://localhost:37777` — should show the claude-mem web viewer

**If broken:** Read `~/.claude/plugins/marketplaces/thedotmack/README.md` and re-wire hooks. The worker needs Bun to run.

### 2. Ruflo Daemon — Finish install and configure
**Status:** Partially installed. The install task got to 60 turns and stalled on a permission prompt. Ruflo itself was installed but the full daemon configuration and ClaudeNightsWatch integration wasn't completed.

**What to do:**
1. Check if Ruflo is actually installed: `npx ruflo@latest --version`
2. If not: `npm install -g ruflo` or `npx ruflo@latest`
3. Start the daemon: `npx ruflo@latest daemon start`
4. Configure session persistence:
   - `npx ruflo@latest hooks session-start --start-daemon`
   - Wire into SessionStart hook chain in `~/.claude/settings.json` alongside superpowers and claude-mem
5. Configure the daemon to reference the Sage-Task-Queue: `C:\Users\mitch\Projects\Cortex\Cortex-Brain\19-META\Sage-Task-Queue.md`
6. Test: `npx ruflo@latest daemon status` — should show running with workers active
7. Verify the SessionStart hook chain fires all three: superpowers → claude-mem → ruflo

### 3. ClaudeNightsWatch — Clone and install
**Status:** Not installed. The Ruflo task was supposed to do this but stalled before getting to it.

**What to do:**
1. Clone: `gh repo clone aniketkarne/ClaudeNightsWatch` into `~/Projects/`
2. Read the README for install instructions
3. Install as a plugin (preferred method): follow the plugin install path
4. Create `task.md` that references the Sage-Task-Queue:
   ```
   # Autonomous Tasks

   ## When idle, execute tasks from the Sage Task Queue
   - Read C:\Users\mitch\Projects\Cortex\Cortex-Brain\19-META\Sage-Task-Queue.md
   - Execute the highest priority incomplete task
   - Follow the session loop: read context → do work → write results → update queue
   - Use start_code_task for anything touching ~/Projects

   ## Fallback tasks (if queue is empty)
   - Run velocity-ai lead enrichment (scrape missing emails)
   - Check Resend DNS verification status
   - Review and update Obsidian vault notes that are stale
   ```
5. Create `rules.md` with safety rules:
   ```
   # Safety Rules

   - Never delete files permanently
   - Always git commit before making changes
   - Never modify .env files or secrets
   - Never push to remote without explicit approval
   - Never run destructive git commands (reset --hard, clean -f)
   - Never send emails or make outbound calls without checking DRY_RUN mode
   - Always write results to the daily log in the vault
   ```
6. Test by triggering a manual run and verifying it picks up a task from the queue

### 4. Hook Chain Verification — Critical
**Status:** Three separate plugins now have SessionStart hooks (superpowers, claude-mem, ruflo). They ALL need to fire on session start without conflicting.

**What to do:**
1. Read `~/.claude/hooks/hooks.json` (or wherever hooks are configured in settings.json)
2. Verify the SessionStart event has entries for all three:
   - Superpowers: `run-hook.cmd session-start` (injects using-superpowers skill)
   - Claude-mem: smart-install check, worker start, context injection
   - Ruflo: daemon start
3. If any are missing, add them
4. Start a brand new Claude Code session and verify in the first few lines of output that all three injected their context
5. Document the final hook configuration in this file or in CLAUDE.md

---

## OPTIONAL — Not Yet Installed

### Everything-claude-code (affaan-m)
- Cloned to `~/Projects/everything-claude-code`
- 38 agents, 156 skills, security scanning, memory optimization
- Heavy overlap with superpowers (already installed)
- **Recommendation:** Cherry-pick only the security scanning and memory optimization pieces. Skip the rest.

### awesome-claude-code-toolkit (rohitg00)
- Not cloned yet
- 135 agents, 42 commands, 19 hooks
- **Recommendation:** Use as a reference catalog, not a full install. Too much overlap with what's already installed.

### CLI-Anything (HKUDS)
- Not cloned
- Turns GUI apps into agent-controllable CLIs
- **Recommendation:** Install later when needed for specific GUI automation tasks

---

## Verification Checklist

After finishing the above, run these checks:

- [ ] `ls ~/.claude/skills/ | wc -l` — should be 90+ skills
- [ ] `ls ~/.claude/hooks/` — should have hooks.json, run-hook.cmd, session-start
- [ ] `ls ~/.claude/agents/` — should have code-reviewer.md
- [ ] `ls ~/.claude/commands/` — should have autoresearch.md + subcommands
- [ ] `cat ~/.claude/settings.json` — allowedTools should have 21+ entries
- [ ] `curl http://localhost:37777` — claude-mem web viewer responds
- [ ] `npx ruflo@latest daemon status` — daemon running
- [ ] Start new Claude Code session — all three hooks fire (superpowers, claude-mem, ruflo)
- [ ] Scheduled tasks fire on next cron time without permission stalls
- [ ] `/autoresearch` command available in session
