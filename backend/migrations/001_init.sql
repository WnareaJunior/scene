-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  username        VARCHAR(30) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT        NOT NULL,
  bio             TEXT,
  gender          VARCHAR(50),
  interests       TEXT[]      DEFAULT '{}',
  profile_picture TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── follows ───────────────────────────────────────────────────────────────────
CREATE TABLE follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- ── events ────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  location       GEOGRAPHY(POINT, 4326) NOT NULL,
  latitude       FLOAT        NOT NULL,
  longitude      FLOAT        NOT NULL,
  address        TEXT,
  start_time     TIMESTAMPTZ  NOT NULL,
  end_time       TIMESTAMPTZ,
  capacity       INTEGER      NOT NULL CHECK (capacity >= 1),
  hashtags       TEXT[]       DEFAULT '{}',
  is_private     BOOLEAN      DEFAULT false,
  show_attendees BOOLEAN      DEFAULT true,
  cancelled      BOOLEAN      DEFAULT false,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX events_location_idx   ON events USING GIST(location);
CREATE INDEX events_start_time_idx ON events(start_time);
CREATE INDEX events_host_id_idx    ON events(host_id);

-- ── rsvps ─────────────────────────────────────────────────────────────────────
CREATE TABLE rsvps (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL CHECK (status IN ('going', 'interested')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX rsvps_event_id_idx ON rsvps(event_id);
CREATE INDEX rsvps_user_id_idx  ON rsvps(user_id);

-- ── refresh_tokens ────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  token      TEXT        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
