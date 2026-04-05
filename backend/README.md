# Scene

A location-based event discovery platform that connects micro-venue hosts and independent artists with local audiences. Find, create, and RSVP to events near you through an intuitive map-based interface.

## Features (MVP)

- **User Authentication** — Sign up with email/password, JWT-based sessions
- **Event Discovery** — Browse events on an interactive map, filter by location, radius, and category
- **Event Creation** — Host events with capacity limits, time, location, tags, and description
- **Social Integration** — Follow other users, discover events from your network
- **RSVP System** — Mark attendance, view attendee lists, enforce capacity limits
- **Comments** — Engage with events via threaded comments

---

## Tech Stack

| Layer          | Technology                          |
|----------------|-------------------------------------|
| Frontend       | React Native (Expo) — iOS & Android |
| Backend        | Python + FastAPI                    |
| Database       | PostgreSQL                          |
| ORM            | SQLAlchemy + Alembic (migrations)   |
| Auth           | JWT via python-jose + bcrypt        |
| Geo Search     | Haversine distance (lat/lng radius) |
| Runtime        | Python 3.11+                        |

---

## Getting Started

### Prerequisites

- Python 3.11+
- PostgreSQL 15+
- Node.js v18+
- Expo CLI
- pip3

---

### Backend Setup

```bash
cd backend
pip3 install fastapi "uvicorn[standard]" sqlalchemy alembic \
  "pydantic[email]" pydantic-settings "python-jose[cryptography]" \
  bcrypt python-dotenv psycopg2-binary passlib
```

Copy and configure your environment:
```bash
cp .env.example .env
```

Backend `.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scene_dev
SECRET_KEY=your-super-secret-key-change-this
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

Create the local database:
```bash
createdb scene_dev
```

Run the server:
```bash
python3 -m uvicorn main:app --reload
```

API will be live at: `http://localhost:8000`
Interactive docs at: `http://localhost:8000/docs`

---

### Frontend Setup

```bash
cd frontend/scene
npm install
npx expo run:ios      # requires Xcode
npx expo run:android  # requires Android Studio
```

---

## Project Structure

```
.
├── backend/
│   ├── main.py                  # FastAPI entry point
│   ├── .env                     # Environment variables (git-ignored)
│   ├── requirements.txt
│   └── app/
│       ├── database.py          # SQLAlchemy engine + session
│       ├── models/
│       │   ├── user.py          # User + followers join table
│       │   └── event.py         # Event, RSVP, Comment
│       ├── schemas/
│       │   ├── user.py          # Pydantic request/response models
│       │   └── event.py
│       ├── routers/
│       │   ├── auth.py          # /api/auth/register, /api/auth/login
│       │   ├── users.py         # /api/users/...
│       │   └── events.py        # /api/events/...
│       └── core/
│           ├── config.py        # Settings from .env
│           └── auth.py          # JWT + password hashing
│
├── frontend/
│   └── scene/
│       ├── App.js
│       ├── index.js
│       ├── Scene.jsx            # Main UI shell
│       └── assets/
│
└── README.md
```

---

## API Overview

Full reference in `BACKEND_ENDPOINTS.md`.

| Method   | Route                          | Auth | Description              |
|----------|--------------------------------|------|--------------------------|
| POST     | /api/auth/register             | No   | Create account           |
| POST     | /api/auth/login                | No   | Get JWT token            |
| GET      | /api/users/me                  | Yes  | Current user profile     |
| GET      | /api/users/{username}          | No   | Public profile           |
| PATCH    | /api/users/me                  | Yes  | Update profile           |
| POST     | /api/users/{id}/follow         | Yes  | Follow a user            |
| DELETE   | /api/users/{id}/follow         | Yes  | Unfollow a user          |
| POST     | /api/events/                   | Yes  | Create event             |
| GET      | /api/events/nearby             | No   | Geo search by radius     |
| GET      | /api/events/{id}               | No   | Get event details        |
| PATCH    | /api/events/{id}               | Yes  | Update event (host only) |
| DELETE   | /api/events/{id}               | Yes  | Delete event (host only) |
| POST     | /api/events/{id}/rsvp          | Yes  | RSVP to event            |
| DELETE   | /api/events/{id}/rsvp          | Yes  | Cancel RSVP              |
| POST     | /api/events/{id}/comments      | Yes  | Post comment             |
| GET      | /api/events/{id}/comments      | No   | Get comments             |

---

## License

GNU Affero General Public License v3.0 — See LICENSE file for details.

## Contributing

This project is closed-source. For inquiries, contact [your-email].