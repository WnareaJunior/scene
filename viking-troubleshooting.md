# OpenViking + Claude Code Troubleshooting

Steps taken to get OpenViking working with Claude Code for this project.

---

## 1. MCP Server Not Connected

**Symptom:** `/mcp` showed the `viking` server as failed or missing.

**Cause:** The MCP server was either not registered, or registered with the wrong transport type.

**Fix:** Remove any bad entry and re-add with the correct transport:

```bash
claude mcp remove viking
claude mcp add --transport http viking http://localhost:1933/mcp
```

**Why HTTP:** OpenViking uses the MCP streamable HTTP transport (not SSE, not stdio). You can confirm by curling the endpoint — it responds with `"Client must accept text/event-stream"` if you don't use the right transport, and returns a proper JSON-RPC response when called correctly.

---

## 2. Plugin Hooks Not Installed

**Symptom:** Persistent memory wasn't working across sessions — Claude couldn't recall things told to it in previous sessions.

**Cause:** The `claude-code-memory-plugin` ships a `hooks/hooks.json` defining three hooks, but `plugin.json` (the manifest the plugin system reads) does not reference it. So Claude Code never auto-installs the hooks.

**Fix:** Manually add the hooks to `~/.claude/settings.json`:

```json
"hooks": {
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "CLAUDE_PLUGIN_ROOT=/Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5 node /Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5/scripts/bootstrap-runtime.mjs",
          "timeout": 120
        }
      ]
    }
  ],
  "UserPromptSubmit": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "CLAUDE_PLUGIN_ROOT=/Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5 node /Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5/scripts/auto-recall.mjs",
          "timeout": 8
        }
      ]
    }
  ],
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "CLAUDE_PLUGIN_ROOT=/Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5 node /Users/wnarea/.claude/plugins/cache/openviking-plugin/claude-code-memory-plugin/0.1.5/scripts/auto-capture.mjs",
          "timeout": 45
        }
      ]
    }
  ]
}
```

**Why hardcoded paths:** `${CLAUDE_PLUGIN_ROOT}` is only set by the plugin system for natively-managed hooks. Manually-added hooks in `settings.json` don't get that variable, so the full path is required.

**What each hook does:**
- `SessionStart` → bootstraps the Node runtime for the MCP adapter
- `UserPromptSubmit` → auto-recalls relevant memories and injects them before each prompt
- `Stop` → auto-captures the session transcript and extracts memories into OV

---

## 3. Wrong viking:// URIs in CLAUDE.md

**Symptom:** Claude fell back to `find` and `grep` instead of querying OV for project context.

**Cause:** `CLAUDE.md` referenced `viking://resources/backend` and `viking://resources/frontend`, but the actual indexed paths are under `viking://resources/repository/`.

**Fix:** Updated `CLAUDE.md` to use the correct URIs:

```
viking://resources/repository/backend
viking://resources/repository/frontend
```

Also strengthened the instruction to make it harder for Claude to skip:

```
## Context Database — MANDATORY FIRST STEP
**Before using Bash, Read, or any filesystem tool**, you MUST call the viking MCP search tool
```

---

## 4. Resources Indexed But No Abstracts Generated

**Symptom:** `ov status` showed healthy queues and OV had files indexed, but searches returned low-quality results and `ov find` showed `[Directory overview is not generated]` for directories.

**Cause:** The resources were added and embedded, but the LLM-based abstract/overview generation (Semantic processing) had never been triggered.

**Fix:**

First, create `~/.openviking/ovcli.conf` (required for `--sudo` commands):

```json
{
  "url": "http://localhost:1933",
  "account": "default",
  "user": "default",
  "root_api_key": "dev"
}
```

> `root_api_key` can be any non-empty string in dev auth mode — the server doesn't validate it.

Then run the reindex with regeneration:

```bash
ov --sudo reindex viking://resources/repository/ --regenerate --wait
```

**Note:** This is slow. With a local Ollama model (`qwen3.5:4b`), processing 45 nodes took ~10 minutes due to the model's thinking mode. It is not broken — just slow. Monitor progress with:

```bash
ov status
```

Watch the `Semantic-Nodes` row — done when `Pending` and `In Progress` are both `0`.

---

## Checking OV Health

```bash
# Full status: queue, vector DB, model calls, retrieval health
ov status

# Quick health check
ov health

# Test semantic search
ov find "your query" --uri viking://resources/repository/backend/
```

---

## Starting OV

OV does not auto-start. Run this before starting Claude Code:

```bash
openviking-server
```

Data persists in `~/.openviking/data/` across restarts — you only need to re-run the reindex if you add new files to the repository.
