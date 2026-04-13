/**
 * Seed script — populates the DB with mock data centered around NYC.
 * Run: node seed.js
 * Requires DATABASE_URL in .env (same as the main server).
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── helpers ───────────────────────────────────────────────────────────────

function days(n) {
  return n * 24 * 60 * 60 * 1000;
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── users ─────────────────────────────────────────────────────────────────

const USERS = [
  {
    username: 'miabk',
    email: 'mia@example.com',
    bio: 'Jazz pianist & event curator based in Brooklyn. Finding the hidden stages of NYC.',
    gender: 'female',
    interests: ['jazz', 'live-music', 'art'],
  },
  {
    username: 'omarnyc',
    email: 'omar@example.com',
    bio: 'DJ / producer spinning house & afrobeats. Williamsburg resident.',
    gender: 'male',
    interests: ['djing', 'afrobeats', 'dance'],
  },
  {
    username: 'priya_creates',
    email: 'priya@example.com',
    bio: 'Visual artist & gallery organizer. Crown Heights forever.',
    gender: 'female',
    interests: ['art', 'gallery', 'community'],
  },
  {
    username: 'devonbx',
    email: 'devon@example.com',
    bio: 'Stand-up comedian. Bronx born. Catch me at open mics across the city.',
    gender: 'male',
    interests: ['comedy', 'open-mic', 'storytelling'],
  },
  {
    username: 'leila_lic',
    email: 'leila@example.com',
    bio: 'Rooftop enthusiast & film nerd. LIC is underrated and I will die on that hill.',
    gender: 'female',
    interests: ['film', 'rooftop', 'photography'],
  },
  {
    username: 'chrisharlem',
    email: 'chris@example.com',
    bio: 'Community organizer & spoken-word poet. Harlem Renaissance 2.0.',
    gender: 'male',
    interests: ['poetry', 'community', 'hiphop'],
  },
  {
    username: 'sofia_soho',
    email: 'sofia@example.com',
    bio: 'Fashion designer hosting pop-up shows & networking nights in SoHo.',
    gender: 'female',
    interests: ['fashion', 'networking', 'design'],
  },
  {
    username: 'kaigreen',
    email: 'kai@example.com',
    bio: 'Yoga instructor & wellness advocate. Movement is medicine.',
    gender: 'non-binary',
    interests: ['yoga', 'wellness', 'dance'],
  },
  {
    username: 'flushing_flo',
    email: 'flo@example.com',
    bio: 'Queens local. Obsessed with food pop-ups and dim sum crawls.',
    gender: 'female',
    interests: ['food', 'pop-up', 'community'],
  },
  {
    username: 'bushwick_bas',
    email: 'bas@example.com',
    bio: 'Electronic music producer & warehouse rave promoter. Bushwick is home.',
    gender: 'male',
    interests: ['techno', 'rave', 'djing'],
  },
];

// ─── events ────────────────────────────────────────────────────────────────
// Each entry references a host by index into USERS array.

const EVENTS = [
  // ── Manhattan ──────────────────────────────────────────────────────────
  {
    hostIdx: 0,
    title: 'Jazz at the Stoop',
    description:
      'Intimate acoustic jazz set on my Lower East Side stoop. BYO drinks, bring a blanket. Limited to 20 people.',
    lat: 40.7150,
    lng: -73.9845,
    address: '171 Ludlow St, New York, NY 10002',
    hoursFromNow: 26,
    durationHours: 3,
    capacity: 20,
    hashtags: ['jazz', 'acoustic', 'les', 'livemusic'],
    isPrivate: false,
  },
  {
    hostIdx: 5,
    title: 'Spoken Word Sunday — Harlem',
    description:
      'Monthly open-mic poetry night in a Harlem community center. All voices welcome. Doors open 30 min early.',
    lat: 40.8116,
    lng: -73.9465,
    address: '2350 Adam Clayton Powell Jr Blvd, New York, NY 10030',
    hoursFromNow: 48,
    durationHours: 2.5,
    capacity: 60,
    hashtags: ['poetry', 'openmic', 'harlem', 'spokenword'],
    isPrivate: false,
  },
  {
    hostIdx: 6,
    title: 'SoHo Pop-Up: Emerging Designers',
    description:
      'Meet five emerging NYC fashion designers in a SoHo loft. Shop exclusive pieces, enjoy wine & conversation.',
    lat: 40.7233,
    lng: -74.0030,
    address: '110 Greene St, New York, NY 10012',
    hoursFromNow: 72,
    durationHours: 4,
    capacity: 40,
    hashtags: ['fashion', 'popup', 'soho', 'design', 'networking'],
    isPrivate: false,
  },
  {
    hostIdx: 7,
    title: 'Sunrise Rooftop Yoga — Chelsea',
    description:
      'All-levels flow at sunrise on a Chelsea rooftop with skyline views. Bring your own mat. $10 suggested donation.',
    lat: 40.7465,
    lng: -74.0014,
    address: '245 W 29th St, New York, NY 10001',
    hoursFromNow: 10,
    durationHours: 1.5,
    capacity: 25,
    hashtags: ['yoga', 'wellness', 'rooftop', 'chelsea', 'sunrise'],
    isPrivate: false,
  },
  {
    hostIdx: 3,
    title: 'Comedy Night at the Deli',
    description:
      'No cover, no bar minimum — just a deli backroom and five comedians who really need the stage time.',
    lat: 40.7234,
    lng: -73.9741,
    address: '88 Ave C, New York, NY 10009',
    hoursFromNow: 36,
    durationHours: 2,
    capacity: 35,
    hashtags: ['comedy', 'openmic', 'eastvillage', 'standup'],
    isPrivate: false,
  },
  {
    hostIdx: 0,
    title: 'Late-Night Jazz Residency',
    description:
      'Friday-night jazz residency with rotating trios. 11 PM start, midnight set. Chinatown basement venue.',
    lat: 40.7158,
    lng: -73.9970,
    address: '22 Mott St, New York, NY 10013',
    hoursFromNow: 60,
    durationHours: 3,
    capacity: 30,
    hashtags: ['jazz', 'latenight', 'chinatown', 'livemusic'],
    isPrivate: false,
  },

  // ── Brooklyn ────────────────────────────────────────────────────────────
  {
    hostIdx: 1,
    title: 'House & Afrobeats Rooftop — Williamsburg',
    description:
      'Rooftop session from 4 PM to sunset. House, afrobeats, and Afro-house selects. BYOB, bring sunscreen.',
    lat: 40.7081,
    lng: -73.9571,
    address: '60 N 7th St, Brooklyn, NY 11249',
    hoursFromNow: 20,
    durationHours: 5,
    capacity: 50,
    hashtags: ['housemusic', 'afrobeats', 'rooftop', 'williamsburg', 'dj'],
    isPrivate: false,
  },
  {
    hostIdx: 2,
    title: 'Crown Heights Art Walk',
    description:
      'Self-guided art walk through five Crown Heights studios + a closing reception with the artists. Free entry.',
    lat: 40.6694,
    lng: -73.9422,
    address: '1000 Dean St, Brooklyn, NY 11216',
    hoursFromNow: 30,
    durationHours: 4,
    capacity: null,
    hashtags: ['art', 'gallery', 'crownheights', 'brooklyn', 'openhouse'],
    isPrivate: false,
  },
  {
    hostIdx: 9,
    title: 'Bushwick Warehouse Rave',
    description:
      'Proper warehouse techno in Bushwick. Four rooms, four selectors, light show, no phones please.',
    lat: 40.6942,
    lng: -73.9246,
    address: '56 Wyckoff Ave, Brooklyn, NY 11237',
    hoursFromNow: 54,
    durationHours: 8,
    capacity: 150,
    hashtags: ['techno', 'rave', 'warehouse', 'bushwick', 'electronicmusic'],
    isPrivate: false,
  },
  {
    hostIdx: 8,
    title: 'Flatbush Food Pop-Up',
    description:
      'Caribbean & West African food vendors in a vacant lot. 8 vendors, live steel drum, bring cash.',
    lat: 40.6421,
    lng: -73.9618,
    address: '1414 Flatbush Ave, Brooklyn, NY 11210',
    hoursFromNow: 44,
    durationHours: 5,
    capacity: 200,
    hashtags: ['food', 'popup', 'caribbean', 'flatbush', 'brooklyn'],
    isPrivate: false,
  },
  {
    hostIdx: 7,
    title: 'Prospect Heights Sound Bath',
    description:
      'Communal sound bath meditation in a beautiful Prospect Heights parlor-floor apartment. 12 spots only.',
    lat: 40.6773,
    lng: -73.9644,
    address: '375 Sterling Pl, Brooklyn, NY 11238',
    hoursFromNow: 18,
    durationHours: 1.5,
    capacity: 12,
    hashtags: ['soundbath', 'meditation', 'wellness', 'prospectheights'],
    isPrivate: false,
  },
  {
    hostIdx: 2,
    title: 'Bed-Stuy Mural Unveiling',
    description:
      'Community celebration for a new 30-foot mural on Fulton St. Live music, food trucks, and a meet-the-artist session.',
    lat: 40.6872,
    lng: -73.9418,
    address: '892 Fulton St, Brooklyn, NY 11238',
    hoursFromNow: 80,
    durationHours: 3,
    capacity: null,
    hashtags: ['art', 'mural', 'bedstuy', 'community', 'brooklyn'],
    isPrivate: false,
  },
  {
    hostIdx: 0,
    title: 'Greenpoint Jazz Courtyard',
    description:
      'Spontaneous jazz session in a Greenpoint community garden courtyard. Acoustic only, no amplification.',
    lat: 40.7299,
    lng: -73.9540,
    address: '134 Calyer St, Brooklyn, NY 11222',
    hoursFromNow: 8,
    durationHours: 2,
    capacity: 30,
    hashtags: ['jazz', 'acoustic', 'greenpoint', 'garden', 'livemusic'],
    isPrivate: false,
  },

  // ── Queens ──────────────────────────────────────────────────────────────
  {
    hostIdx: 1,
    title: 'Astoria Rooftop DJ Night',
    description:
      'Sunset DJ set on a rooftop overlooking Astoria Park. Chill vibes, cold drinks, Manhattan skyline in the background.',
    lat: 40.7721,
    lng: -73.9302,
    address: '27-08 31st Ave, Astoria, NY 11102',
    hoursFromNow: 14,
    durationHours: 4,
    capacity: 45,
    hashtags: ['dj', 'rooftop', 'astoria', 'queens', 'sunset'],
    isPrivate: false,
  },
  {
    hostIdx: 4,
    title: 'LIC Film Screening: Short Films Night',
    description:
      'Outdoor screening of short films by NYC-based filmmakers on a Long Island City rooftop. Free, first come first served.',
    lat: 40.7447,
    lng: -73.9485,
    address: '44-01 Purves St, Long Island City, NY 11101',
    hoursFromNow: 32,
    durationHours: 3,
    capacity: 60,
    hashtags: ['film', 'screening', 'lic', 'queens', 'shortfilms'],
    isPrivate: false,
  },
  {
    hostIdx: 8,
    title: 'Flushing Night Market',
    description:
      'Community night market in Flushing with 20+ vendors. Dumplings, boba, takoyaki, and more. Family-friendly.',
    lat: 40.7675,
    lng: -73.8330,
    address: '133-35 Roosevelt Ave, Flushing, NY 11354',
    hoursFromNow: 16,
    durationHours: 4,
    capacity: null,
    hashtags: ['food', 'nightmarket', 'flushing', 'queens', 'community'],
    isPrivate: false,
  },
  {
    hostIdx: 6,
    title: 'Ridgewood Vintage Swap',
    description:
      'Vintage clothing swap and sale in a Ridgewood backyard. Trade three items, browse 200+. Coffee & pastries.',
    lat: 40.7031,
    lng: -73.9062,
    address: '66-04 Forest Ave, Ridgewood, NY 11385',
    hoursFromNow: 40,
    durationHours: 3,
    capacity: 80,
    hashtags: ['vintage', 'fashion', 'swap', 'ridgewood', 'queens'],
    isPrivate: false,
  },

  // ── The Bronx ───────────────────────────────────────────────────────────
  {
    hostIdx: 3,
    title: 'Bronx Comedy Showcase',
    description:
      'Monthly comedy showcase featuring 8 comics from The Bronx and beyond. Hosted at a Fordham community center.',
    lat: 40.8609,
    lng: -73.8958,
    address: '2474 Grand Concourse, Bronx, NY 10458',
    hoursFromNow: 56,
    durationHours: 2.5,
    capacity: 75,
    hashtags: ['comedy', 'standup', 'bronx', 'showcase'],
    isPrivate: false,
  },
  {
    hostIdx: 5,
    title: 'Grand Concourse Poetry & Jazz',
    description:
      'An evening combining spoken word and jazz improvisation in The Bronx. Collaborative, experimental, free.',
    lat: 40.8448,
    lng: -73.8648,
    address: '1 E 161st St, Bronx, NY 10451',
    hoursFromNow: 96,
    durationHours: 2,
    capacity: 50,
    hashtags: ['poetry', 'jazz', 'bronx', 'experimental', 'livemusic'],
    isPrivate: false,
  },

  // ── Private / invite-only ───────────────────────────────────────────────
  {
    hostIdx: 9,
    title: 'Invite-Only Studio Session — Bushwick',
    description:
      'Private studio listening party for an unreleased EP. DM to request an invite.',
    lat: 40.6970,
    lng: -73.9212,
    address: '68 Troutman St, Brooklyn, NY 11237',
    hoursFromNow: 70,
    durationHours: 3,
    capacity: 15,
    hashtags: ['music', 'studio', 'bushwick', 'exclusive'],
    isPrivate: true,
  },
];

// ─── follow graph ──────────────────────────────────────────────────────────
// [followerIdx, followedIdx]

const FOLLOWS = [
  [1, 0], [2, 0], [5, 0], [6, 0], [9, 0],   // mia has lots of followers
  [0, 1], [2, 1], [7, 1], [8, 1],
  [0, 2], [3, 2], [5, 2],
  [0, 3], [1, 3], [4, 3],
  [0, 4], [1, 4], [6, 4],
  [0, 5], [2, 5], [8, 5],
  [1, 6], [3, 6], [7, 6],
  [0, 7], [8, 7], [9, 7],
  [0, 8], [1, 8], [3, 8], [9, 8],
  [0, 9], [1, 9], [2, 9], [4, 9],
];

// ─── rsvp assignments ──────────────────────────────────────────────────────
// [userIdx, eventIdx, status]  (host is skipped automatically)

const RSVPS = [
  // Jazz at the Stoop
  [1, 0, 'going'], [2, 0, 'going'], [5, 0, 'interested'], [7, 0, 'interested'],

  // Spoken Word Sunday
  [0, 1, 'going'], [2, 1, 'going'], [3, 1, 'going'], [8, 1, 'interested'],

  // SoHo Pop-Up
  [0, 2, 'interested'], [4, 2, 'interested'], [7, 2, 'going'], [9, 2, 'interested'],

  // Sunrise Rooftop Yoga
  [0, 3, 'going'], [2, 3, 'going'], [6, 3, 'going'], [9, 3, 'interested'],

  // Comedy Night at the Deli
  [0, 4, 'going'], [1, 4, 'going'], [5, 4, 'interested'], [8, 4, 'going'],

  // Late-Night Jazz Residency
  [1, 5, 'going'], [4, 5, 'interested'], [6, 5, 'interested'], [9, 5, 'going'],

  // House & Afrobeats Rooftop
  [0, 6, 'going'], [2, 6, 'going'], [4, 6, 'going'], [7, 6, 'interested'], [9, 6, 'going'],

  // Crown Heights Art Walk
  [0, 7, 'going'], [1, 7, 'interested'], [5, 7, 'going'], [6, 7, 'going'], [8, 7, 'going'],

  // Bushwick Warehouse Rave
  [0, 8, 'interested'], [1, 8, 'going'], [3, 8, 'going'], [4, 8, 'interested'], [7, 8, 'going'],

  // Flatbush Food Pop-Up
  [0, 9, 'going'], [2, 9, 'going'], [5, 9, 'going'], [6, 9, 'interested'], [7, 9, 'going'],

  // Prospect Heights Sound Bath
  [0, 10, 'going'], [2, 10, 'going'], [5, 10, 'going'], [6, 10, 'going'],

  // Bed-Stuy Mural Unveiling
  [1, 11, 'going'], [5, 11, 'going'], [7, 11, 'going'], [8, 11, 'interested'],

  // Greenpoint Jazz Courtyard
  [1, 12, 'interested'], [5, 12, 'going'], [6, 12, 'going'], [9, 12, 'interested'],

  // Astoria Rooftop DJ
  [0, 13, 'going'], [2, 13, 'interested'], [3, 13, 'going'], [8, 13, 'going'],

  // LIC Film Screening
  [0, 14, 'going'], [1, 14, 'interested'], [3, 14, 'going'], [6, 14, 'interested'], [9, 14, 'going'],

  // Flushing Night Market
  [0, 15, 'going'], [2, 15, 'going'], [3, 15, 'going'], [7, 15, 'interested'],

  // Ridgewood Vintage Swap
  [0, 16, 'interested'], [2, 16, 'going'], [4, 16, 'going'], [7, 16, 'going'],

  // Bronx Comedy Showcase
  [0, 17, 'going'], [1, 17, 'interested'], [5, 17, 'going'], [6, 17, 'interested'],

  // Grand Concourse Poetry & Jazz
  [0, 18, 'going'], [2, 18, 'going'], [4, 18, 'interested'], [7, 18, 'going'],

  // Invite-Only Studio Session (no host RSVPs anyway)
  [1, 19, 'going'], [4, 19, 'going'],
];

// ─── seed ─────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing data (reverse FK order)
    console.log('Clearing existing data…');
    await client.query('DELETE FROM rsvps');
    await client.query('DELETE FROM follows');
    await client.query('DELETE FROM events');
    await client.query('DELETE FROM refresh_tokens');
    await client.query('DELETE FROM users');

    // ── insert users ────────────────────────────────────────────────────
    console.log('Inserting users…');
    const userIds = [];
    const passwordHash = await bcrypt.hash('Password123!', 12); // same pw for all seed users

    for (const u of USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, username, bio, gender, interests)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [u.email, passwordHash, u.username, u.bio, u.gender, u.interests]
      );
      userIds.push(rows[0].id);
      console.log(`  ✓ @${u.username}`);
    }

    // ── insert events ───────────────────────────────────────────────────
    console.log('Inserting events…');
    const eventIds = [];

    for (const e of EVENTS) {
      const hostId = userIds[e.hostIdx];
      const startTime = hoursFromNow(e.hoursFromNow);
      const endTime = e.durationHours
        ? new Date(startTime.getTime() + e.durationHours * 60 * 60 * 1000)
        : null;

      const { rows } = await client.query(
        `INSERT INTO events
           (host_id, title, description, location, latitude, longitude, address,
            start_time, end_time, capacity, hashtags, is_private, show_attendees, status)
         VALUES
           ($1, $2, $3,
            ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
            $5, $4,
            $6, $7, $8, $9, $10, $11, true, 'active')
         RETURNING id`,
        [
          hostId,
          e.title,
          e.description,
          e.lng,   // $4 → longitude → ST_MakePoint(lng, lat)
          e.lat,   // $5 → latitude
          e.address,
          startTime,
          endTime,
          e.capacity,
          e.hashtags,
          e.isPrivate,
        ]
      );
      eventIds.push(rows[0].id);
      console.log(`  ✓ ${e.title}`);
    }

    // ── insert follows ──────────────────────────────────────────────────
    console.log('Inserting follows…');
    for (const [fi, fdi] of FOLLOWS) {
      await client.query(
        `INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userIds[fi], userIds[fdi]]
      );
    }
    console.log(`  ✓ ${FOLLOWS.length} follow relationships`);

    // ── insert rsvps ────────────────────────────────────────────────────
    console.log('Inserting RSVPs…');
    let rsvpCount = 0;
    for (const [ui, ei, status] of RSVPS) {
      const userId = userIds[ui];
      const eventId = eventIds[ei];
      const hostId = userIds[EVENTS[ei].hostIdx];

      // Skip if the user is the event host
      if (userId === hostId) continue;

      await client.query(
        `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [eventId, userId, status]
      );
      rsvpCount++;
    }
    console.log(`  ✓ ${rsvpCount} RSVPs`);

    await client.query('COMMIT');
    console.log('\nSeed complete!');
    console.log('─────────────────────────────────');
    console.log(`Users   : ${USERS.length}`);
    console.log(`Events  : ${EVENTS.length}`);
    console.log(`Follows : ${FOLLOWS.length}`);
    console.log(`RSVPs   : ${rsvpCount}`);
    console.log('\nAll seed users share the password: Password123!');
    console.log('Example login → email: mia@example.com  password: Password123!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
