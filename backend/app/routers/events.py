import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event, RSVP, Comment
from app.models.user import User
from app.schemas.event import (
    EventCreate, EventOut, EventUpdate,
    CommentCreate, CommentOut, RSVPOut,
)
from app.core.auth import get_current_user

router = APIRouter()


# ── Geo helper (Haversine) ────────────────────────────────────────────────────
def haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# ── Events CRUD ───────────────────────────────────────────────────────────────
@router.post("/", response_model=EventOut, status_code=201)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = Event(**payload.model_dump(), host_id=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/nearby", response_model=List[EventOut])
def get_nearby_events(
    lat:        float = Query(..., description="Center latitude"),
    lng:        float = Query(..., description="Center longitude"),
    radius_km:  float = Query(10.0, description="Search radius in km"),
    tag:        Optional[str] = Query(None, description="Filter by tag"),
    db:         Session = Depends(get_db),
):
    events = db.query(Event).filter(Event.status == "live").all()

    results = []
    for ev in events:
        dist = haversine_km(lat, lng, ev.lat, ev.lng)
        if dist <= radius_km:
            if tag and tag.lower() not in [t.lower() for t in ev.tags]:
                continue
            results.append(ev)

    results.sort(key=lambda e: haversine_km(lat, lng, e.lat, e.lng))
    return results


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.patch("/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your event")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your event")
    db.delete(event)
    db.commit()


# ── RSVPs ─────────────────────────────────────────────────────────────────────
@router.post("/{event_id}/rsvp", response_model=RSVPOut, status_code=201)
def rsvp(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    existing = db.query(RSVP).filter(
        RSVP.user_id == current_user.id, RSVP.event_id == event_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already RSVPed")
    rsvp = RSVP(user_id=current_user.id, event_id=event_id)
    db.add(rsvp)
    db.commit()
    db.refresh(rsvp)
    return rsvp


@router.delete("/{event_id}/rsvp", status_code=204)
def cancel_rsvp(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rsvp = db.query(RSVP).filter(
        RSVP.user_id == current_user.id, RSVP.event_id == event_id
    ).first()
    if not rsvp:
        raise HTTPException(status_code=404, detail="RSVP not found")
    db.delete(rsvp)
    db.commit()


# ── Comments ──────────────────────────────────────────────────────────────────
@router.post("/{event_id}/comments", response_model=CommentOut, status_code=201)
def post_comment(
    event_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    comment = Comment(event_id=event_id, user_id=current_user.id, text=payload.text)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.get("/{event_id}/comments", response_model=List[CommentOut])
def get_comments(event_id: int, db: Session = Depends(get_db)):
    return db.query(Comment).filter(Comment.event_id == event_id).all()
