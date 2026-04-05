from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import auth, users, events

# Create all tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Scene API",
    description="Backend for the Scene event discovery platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,   prefix="/api/auth",   tags=["Auth"])
app.include_router(users.router,  prefix="/api/users",  tags=["Users"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])


@app.get("/")
def root():
    return {"status": "Scene API is live"}
