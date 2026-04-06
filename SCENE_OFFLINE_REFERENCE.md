# Scene Backend — Offline Reference

Quick reference for building the Scene FastAPI backend without internet access.

---

## Starting the Server

```bash
cd backend
python3 -m uvicorn main:app --reload
```

- API: http://localhost:8000
- Swagger UI (interactive docs): http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## PostgreSQL Cheatsheet

```bash
# Start postgres (if not running as a service)
/opt/homebrew/opt/postgresql@15/bin/postgres -D /opt/homebrew/var/postgresql@15

# Connect to your DB
psql scene_dev

# Common psql commands (run inside psql shell)
\dt              # list all tables
\d users         # describe users table
\q               # quit

# Run a query
SELECT * FROM users;
SELECT * FROM events LIMIT 5;
DELETE FROM users WHERE id = 1;
```

---

## SQLAlchemy Quick Reference

### Defining a model
```python
from sqlalchemy import Column, Integer, String
from app.database import Base

class MyModel(Base):
    __tablename__ = "my_table"
    id   = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
```

### Querying
```python
# Get all
db.query(User).all()

# Filter
db.query(User).filter(User.email == "test@test.com").first()

# Filter multiple
db.query(Event).filter(Event.host_id == 1, Event.status == "live").all()

# Create
user = User(username="wilsn", email="w@w.com", password=hashed)
db.add(user)
db.commit()
db.refresh(user)  # reload from DB to get id, created_at, etc.

# Update
user.bio = "new bio"
db.commit()

# Delete
db.delete(user)
db.commit()
```

### Relationships
```python
# Access related data (lazy loaded by default)
event.host         # User object
event.rsvps        # list of RSVP objects
user.events        # list of Event objects
```

---

## FastAPI Quick Reference

### Basic route
```python
from fastapi import APIRouter
router = APIRouter()

@router.get("/items/{item_id}")
def get_item(item_id: int):
    return {"id": item_id}
```

### Route with DB dependency
```python
from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db

@router.get("/users")
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()
```

### Protected route (requires JWT)
```python
from app.core.auth import get_current_user
from app.models.user import User

@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
```

### Query parameters
```python
from fastapi import Query

@router.get("/events/nearby")
def nearby(
    lat: float = Query(...),           # required
    lng: float = Query(...),           # required
    radius_km: float = Query(10.0),    # optional with default
):
    ...
```

### HTTP errors
```python
from fastapi import HTTPException

raise HTTPException(status_code=404, detail="Not found")
raise HTTPException(status_code=400, detail="Bad request")
raise HTTPException(status_code=403, detail="Forbidden")
raise HTTPException(status_code=401, detail="Unauthorized")
```

### Response model (shapes the JSON output)
```python
from app.schemas.user import UserOut

@router.get("/users/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
```

---

## Pydantic Quick Reference

### Schema definition
```python
from pydantic import BaseModel
from typing import Optional

class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    lat: float
    lng: float
```

### Reading from ORM model (SQLAlchemy → Pydantic)
```python
class EventOut(BaseModel):
    id: int
    title: str

    class Config:
        from_attributes = True   # required to read from SQLAlchemy objects
```

### Updating with partial data
```python
payload.model_dump(exclude_none=True)  # only fields that were provided
```

---

## JWT Auth Flow

### How it works
1. User calls `POST /api/auth/login` with email + password
2. Server verifies password, returns `access_token`
3. Client sends token in every protected request header:
   ```
   Authorization: Bearer <token>
   ```
4. `get_current_user` dependency decodes token and returns the User

### Creating a token
```python
from app.core.auth import create_access_token

token = create_access_token({"sub": str(user.id)})
```

### Decoding (handled automatically by get_current_user)
```python
payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
user_id = payload.get("sub")
```

---

## Alembic Migrations (for later)

```bash
# Init (already done if alembic/ folder exists)
alembic init alembic

# Create a migration after changing a model
alembic revision --autogenerate -m "add photo_url to users"

# Apply migrations
alembic upgrade head

# Roll back one step
alembic downgrade -1
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `uvicorn not found` | Not in PATH | Use `python3 -m uvicorn main:app --reload` |
| `ModuleNotFoundError` | Missing package | `pip3 install <package>` |
| `connection refused` (DB) | Postgres not running | Run postgres manually (see above) |
| `relation does not exist` | Tables not created | Make sure `Base.metadata.create_all(bind=engine)` runs in main.py |
| `422 Unprocessable Entity` | Bad request body | Check required fields in the schema |
| `401 Unauthorized` | Missing/bad token | Include `Authorization: Bearer <token>` header |
| `could not find BCRYPT_256` | passlib issue | `pip3 install "passlib[bcrypt]"` |

---

## Testing Endpoints Without Internet

Use the built-in Swagger UI at `http://localhost:8000/docs` — it lets you send requests directly from the browser, no Postman needed.

### Workflow
1. Register: `POST /api/auth/register`
2. Login: `POST /api/auth/login` → copy the `access_token`
3. Click **Authorize** (top right in Swagger) → paste token
4. All protected routes now work from the UI

---

## File Responsibilities (quick map)

| File | What it does |
|------|-------------|
| `main.py` | Starts the app, registers routers, creates tables |
| `app/database.py` | DB engine, session factory, `get_db` dependency |
| `app/core/config.py` | Reads `.env` into a typed Settings object |
| `app/core/auth.py` | Password hashing, JWT create/decode, `get_current_user` |
| `app/models/user.py` | User + followers table SQLAlchemy model |
| `app/models/event.py` | Event, RSVP, Comment SQLAlchemy models |
| `app/schemas/user.py` | Pydantic shapes for user requests/responses |
| `app/schemas/event.py` | Pydantic shapes for event requests/responses |
| `app/routers/auth.py` | `/api/auth/register` and `/api/auth/login` |
| `app/routers/users.py` | User profile, follow/unfollow, delete |
| `app/routers/events.py` | Event CRUD, geo search, RSVPs, comments |
