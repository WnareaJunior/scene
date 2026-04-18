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