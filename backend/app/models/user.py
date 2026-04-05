from sqlalchemy import Column, Integer, String, Text, DateTime, Table, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base

# Followers join table (self-referential many-to-many)
followers = Table(
    "followers",
    Base.metadata,
    Column("follower_id",  Integer, ForeignKey("users.id"), primary_key=True),
    Column("following_id", Integer, ForeignKey("users.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String(50),  unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    email        = Column(String(255), unique=True, nullable=False, index=True)
    password     = Column(String(255), nullable=False)
    bio          = Column(Text, nullable=True)
    photo_url    = Column(String(500), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    events = relationship("Event", back_populates="host", cascade="all, delete-orphan")
    rsvps  = relationship("RSVP",  back_populates="user", cascade="all, delete-orphan")

    following = relationship(
        "User",
        secondary=followers,
        primaryjoin=id == followers.c.follower_id,
        secondaryjoin=id == followers.c.following_id,
        backref="followers",
    )
