// scripts/seed.js
import { faker } from '@faker-js/faker';
import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// NYC bounding box — good for SCENE
const nycBounds = {
  lat: { min: 40.4774, max: 40.9176 },
  lng: { min: -74.2591, max: -73.7004 },
};

const randomNYCCoords = () => ({
  lat: faker.number.float({ min: nycBounds.lat.min, max: nycBounds.lat.max, fractionDigits: 6 }),
  lng: faker.number.float({ min: nycBounds.lng.min, max: nycBounds.lng.max, fractionDigits: 6 }),
});

const INTERESTS = ['music', 'art', 'food', 'nightlife', 'sports', 'tech', 'comedy', 'film', 'dance', 'wellness'];
const HASHTAGS   = ['#nyc', '#brooklyn', '#manhattan', '#queens', '#livemusic', '#popup', '#rooftop', '#openmic', '#artshow', '#brunch'];

// ─── Seed Users ───────────────────────────────────────────────────────────────
const seedUsers = async (count = 30) => {
  console.log(`Creating ${count} users...`);
  const passwordHash = await bcrypt.hash('password123', 10); // same hash for all test users
  const ids = [];

  for (let i = 0; i < count; i++) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, username, bio, gender, interests, profile_picture)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        faker.internet.email().toLowerCase(),
        passwordHash,
        faker.internet.username().toLowerCase().slice(0, 20),
        faker.lorem.sentence(),
        faker.helpers.arrayElement(['male', 'female', 'nonbinary', null]),
        faker.helpers.arrayElements(INTERESTS, faker.number.int({ min: 1, max: 4 })),
        faker.image.avatar(),
      ]
    );
    if (rows[0]) ids.push(rows[0].id);
  }

  console.log(`  ✓ ${ids.length} users created`);
  return ids;
};

// ─── Seed Follows ─────────────────────────────────────────────────────────────
const seedFollows = async (userIds) => {
  console.log('Creating follows...');
  let count = 0;

  for (const userId of userIds) {
    const targets = faker.helpers.arrayElements(
      userIds.filter(id => id !== userId),
      faker.number.int({ min: 2, max: 8 })
    );

    for (const targetId of targets) {
      await pool.query(
        `INSERT INTO follows (follower_id, followed_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, targetId]
      );
      count++;
    }
  }

  console.log(`  ✓ ${count} follows created`);
};

// ─── Seed Events ──────────────────────────────────────────────────────────────
const seedEvents = async (userIds, count = 20) => {
  console.log(`Creating ${count} events...`);
  const ids = [];

  for (let i = 0; i < count; i++) {
    const { lat, lng } = randomNYCCoords();
    const startTime = faker.date.soon({ days: 21 });
    const endTime   = new Date(startTime.getTime() + faker.number.int({ min: 1, max: 5 }) * 3600000);

    const { rows } = await pool.query(
      `INSERT INTO events
         (host_id, title, description, location, latitude, longitude, address,
          start_time, end_time, capacity, hashtags, is_private)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326), $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        faker.helpers.arrayElement(userIds),
        faker.helpers.arrayElement([
          'Rooftop Session', 'Open Mic Night', 'Pop-Up Market', 'Gallery Opening',
          'Block Party', 'Jazz Night', 'Film Screening', 'DJ Set', 'Wellness Workshop',
          'Networking Mixer'
        ]) + ' – ' + faker.location.city(),
        faker.lorem.sentences(2),
        lat,
        lng,
        faker.location.streetAddress() + ', New York, NY',
        startTime,
        endTime,
        faker.helpers.arrayElement([null, 20, 50, 100, 200]),
        faker.helpers.arrayElements(HASHTAGS, faker.number.int({ min: 1, max: 4 })),
        faker.datatype.boolean({ probability: 0.15 }), // 15% private
      ]
    );
    if (rows[0]) ids.push(rows[0].id);
  }

  console.log(`  ✓ ${ids.length} events created`);
  return ids;
};

// ─── Seed RSVPs ───────────────────────────────────────────────────────────────
const seedRsvps = async (userIds, eventIds) => {
  console.log('Creating RSVPs...');
  let count = 0;

  for (const eventId of eventIds) {
    const attendees = faker.helpers.arrayElements(
      userIds,
      faker.number.int({ min: 1, max: Math.min(10, userIds.length) })
    );

    for (const userId of attendees) {
      await pool.query(
        `INSERT INTO rsvps (event_id, user_id, status)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [eventId, userId, faker.helpers.arrayElement(['going', 'interested'])]
      );
      count++;
    }
  }

  console.log(`  ✓ ${count} RSVPs created`);
};

// ─── Teardown ─────────────────────────────────────────────────────────────────
const unseed = async () => {
  console.log('Removing seed data...');
  // Cascades handle rsvps, follows, refresh_tokens
  await pool.query(`DELETE FROM events WHERE title LIKE '%–%'`);
  await pool.query(`DELETE FROM users WHERE email NOT LIKE '%your-real-accounts%'`);
  console.log('  ✓ Done');
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const seed = async () => {
  try {
    const userIds  = await seedUsers(30);
    await seedFollows(userIds);
    const eventIds = await seedEvents(userIds, 20);
    await seedRsvps(userIds, eventIds);
    console.log('\n✅ Seed complete');
  } catch (err) {
    console.error('Seed failed:', err);
  } finally {
    await pool.end();
  }
};

// Run: node scripts/seed.js
// Teardown: node scripts/seed.js --unseed
process.argv.includes('--unseed') ? unseed().finally(() => pool.end()) : seed();