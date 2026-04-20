# Scene — Claude Code Instructions

## Context Database
OpenViking is running at http://localhost:1933.
Before starting any task, query relevant context:
- Backend tasks: search viking://resources/backend
- Frontend tasks: search viking://resources/frontend
- Always check existing routes before adding new ones

## Stack
- Frontend: React Native / Expo
- Backend: Node.js / Express / PostgreSQL / PostGIS
- Auth: JWT middleware at src/middleware/auth.js
- Routes: src/routes/ (events, auth, users, map)

## Rules
- Never modify migrations without explicit approval
- All new routes follow existing pattern in events.js
- Open a PR for every change, never push directly to main
- Run promptfoo eval before any PR touching AI logic

## Agent Scope — Mandatory
- Only write or edit files inside `backend/src/` and `frontend/`
- Never modify `.claude/settings.json`, `CLAUDE.md`, `orchestrate.sh`, or any tooling/config file
- Never request permission changes — implement the task directly in source files
- If a task requires a migration, describe it in a comment and stop; do not create or modify migration files
