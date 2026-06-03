#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
TASKS_DIR="$REPO_ROOT/tasks"

# ── Collect task files ────────────────────────────────────────────────────────
shopt -s nullglob
TASKS=("$TASKS_DIR"/*.md)
shopt -u nullglob

TOTAL=${#TASKS[@]}

if [ "$TOTAL" -eq 0 ]; then
  echo "No .md files found in tasks/"
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Scene Batch Orchestrator"
echo "  $TOTAL task(s) found"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DONE=0
SKIPPED=0
FAILED=0

for IDX in "${!TASKS[@]}"; do
  TASK_FILE="${TASKS[$IDX]}"
  COUNTER="[$((IDX + 1))/$TOTAL]"
  TASK_TITLE=$(head -1 "$TASK_FILE" | sed 's/^#[[:space:]]*//')

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$COUNTER $TASK_TITLE"
  echo "  File: $(basename "$TASK_FILE")"

  # ── Check for existing open PR (re-fetch each iteration) ───────────────────
  OPEN_PR=$(gh pr list --state open --json title -q '.[].title' 2>/dev/null \
            | grep -xF "$TASK_TITLE" || true)

  if [ -n "$OPEN_PR" ]; then
    echo "  ⏭  Skipping — open PR already exists for this title"
    SKIPPED=$((SKIPPED + 1))
    echo ""
    continue
  fi

  # ── Ensure we start from main ───────────────────────────────────────────────
  CURRENT_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  if [[ "$CURRENT_BRANCH" != "main" ]] && [[ "$CURRENT_BRANCH" != "master" ]]; then
    echo "  ⚠  Currently on '$CURRENT_BRANCH' — switching to main first"
    git -C "$REPO_ROOT" checkout main
  fi

  echo ""

  # ── Run orchestrator ────────────────────────────────────────────────────────
  if "$REPO_ROOT/orchestrate.sh" "$TASK_FILE"; then
    DONE=$((DONE + 1))
  else
    echo ""
    echo "  ❌ orchestrate.sh failed — continuing to next task"
    FAILED=$((FAILED + 1))
    # Recover to main so the next task gets a clean branch
    git -C "$REPO_ROOT" checkout main 2>/dev/null || true
  fi

  # ── Pause between runs (skip after last task) ───────────────────────────────
  if [ "$((IDX + 1))" -lt "$TOTAL" ]; then
    echo ""
    echo "  Pausing 5s before next task..."
    sleep 5
  fi

  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Batch complete"
echo "  ✅ Succeeded: $DONE"
echo "  ⏭  Skipped:   $SKIPPED"
echo "  ❌ Failed:    $FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
