#!/usr/bin/env node
//
// Seed realistic NYC events across all five boroughs.
//
//   node scripts/seed-nyc-events.js --count 200            # default 200
//   node scripts/seed-nyc-events.js --count 50 --seed 7    # reproducible
//   node scripts/seed-nyc-events.js --dry-run              # print, no writes
//
// Every description is real English (never lorem) so the search pipeline's
// lexical AND semantic paths both have something to retrieve. Events spread
// over the next 1–5 weeks, weighted toward evenings and weekends. Hosts are
// a fixed roster with @example.com emails — the same convention as the
// legacy seed, distinct from @scene-seed.app (which App-Review cleanup
// deletes) and trivially identifiable for a future purge:
//   DELETE FROM events e USING users u
//    WHERE u.id = e.host_id AND u.email LIKE '%@example.com';
//
// Uses DATABASE_URL from the environment (backend/.env by default — staging).
// Aim it at prod by exporting .env.production first.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

// ── deterministic RNG (mulberry32) ───────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
}
const COUNT = Number(argVal('--count', 200));
const SEED = Number(argVal('--seed', 1));
const DRY = args.includes('--dry-run');
const rand = mulberry32(SEED);

const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ── neighborhoods: real centers, all five boroughs ───────────────────────────
const HOODS = [
  // Manhattan
  { name: 'Harlem',             borough: 'Manhattan',     lat: 40.8116, lng: -73.9465 },
  { name: 'Washington Heights', borough: 'Manhattan',     lat: 40.8417, lng: -73.9394 },
  { name: 'East Village',       borough: 'Manhattan',     lat: 40.7265, lng: -73.9815 },
  { name: 'Lower East Side',    borough: 'Manhattan',     lat: 40.7150, lng: -73.9843 },
  { name: 'SoHo',               borough: 'Manhattan',     lat: 40.7233, lng: -74.0030 },
  { name: 'Chelsea',            borough: 'Manhattan',     lat: 40.7465, lng: -74.0014 },
  { name: 'Midtown',            borough: 'Manhattan',     lat: 40.7549, lng: -73.9840 },
  { name: 'Chinatown',          borough: 'Manhattan',     lat: 40.7158, lng: -73.9970 },
  // Brooklyn
  { name: 'Williamsburg',       borough: 'Brooklyn',      lat: 40.7081, lng: -73.9571 },
  { name: 'Bushwick',           borough: 'Brooklyn',      lat: 40.6944, lng: -73.9213 },
  { name: 'Greenpoint',         borough: 'Brooklyn',      lat: 40.7245, lng: -73.9500 },
  { name: 'Crown Heights',      borough: 'Brooklyn',      lat: 40.6694, lng: -73.9422 },
  { name: 'Bed-Stuy',           borough: 'Brooklyn',      lat: 40.6872, lng: -73.9418 },
  { name: 'Park Slope',         borough: 'Brooklyn',      lat: 40.6710, lng: -73.9814 },
  { name: 'DUMBO',              borough: 'Brooklyn',      lat: 40.7033, lng: -73.9881 },
  { name: 'Flatbush',           borough: 'Brooklyn',      lat: 40.6409, lng: -73.9594 },
  // Queens
  { name: 'Astoria',            borough: 'Queens',        lat: 40.7644, lng: -73.9235 },
  { name: 'Long Island City',   borough: 'Queens',        lat: 40.7447, lng: -73.9485 },
  { name: 'Flushing',           borough: 'Queens',        lat: 40.7675, lng: -73.8331 },
  { name: 'Jackson Heights',    borough: 'Queens',        lat: 40.7557, lng: -73.8831 },
  { name: 'Ridgewood',          borough: 'Queens',        lat: 40.7043, lng: -73.9018 },
  { name: 'Forest Hills',       borough: 'Queens',        lat: 40.7185, lng: -73.8458 },
  // Bronx
  { name: 'Mott Haven',         borough: 'The Bronx',     lat: 40.8091, lng: -73.9229 },
  { name: 'Fordham',            borough: 'The Bronx',     lat: 40.8592, lng: -73.8985 },
  { name: 'Grand Concourse',    borough: 'The Bronx',     lat: 40.8320, lng: -73.9200 },
  { name: 'Riverdale',          borough: 'The Bronx',     lat: 40.8899, lng: -73.9068 },
  { name: 'Pelham Bay',         borough: 'The Bronx',     lat: 40.8503, lng: -73.8331 },
  // Staten Island
  { name: 'St. George',         borough: 'Staten Island', lat: 40.6432, lng: -74.0776 },
  { name: 'Stapleton',          borough: 'Staten Island', lat: 40.6265, lng: -74.0779 },
  { name: 'Tottenville',        borough: 'Staten Island', lat: 40.5083, lng: -74.2354 },
];

const STREETS = ['Ave A', 'Grand St', 'Bedford Ave', 'Myrtle Ave', 'Steinway St', 'Ditmars Blvd', 'Nostrand Ave', 'Fulton St', 'Vernon Blvd', 'Wyckoff Ave', 'Union St', 'Graham Ave', 'Broadway', 'Amsterdam Ave', 'Lenox Ave', 'Bay St', 'Victory Blvd', 'Willis Ave', 'Arthur Ave', 'Roosevelt Ave'];

// ── archetypes: {titles, descriptions, hashtags, startHours, durationH} ──────
// Description slots: {hood} {borough}. Multiple templates per archetype so a
// query like "techno" or "free food" has varied but findable matches.
const ARCHETYPES = [
  {
    key: 'techno',
    titles: ['Warehouse Techno: {hood}', 'All-Night Techno in {hood}', '{hood} Warehouse Session'],
    descs: [
      'Proper warehouse techno in {hood}. Four-on-the-floor until sunrise, industrial room, serious sound system. No phones on the dancefloor.',
      'Underground techno night in a converted {hood} loft. Dark room, heavy low end, local selectors going back to back all night.',
      'Hard-hitting techno and electro in {hood}. BYOB, cash door, lineup announced day-of. Come to dance, not to talk.',
    ],
    hashtags: ['techno', 'warehouse', 'rave'], startHours: [22, 23], durationH: [6, 8],
  },
  {
    key: 'house',
    titles: ['{hood} House Party', 'Deep House Rooftop — {hood}', 'House & Disco: {hood} Edition'],
    descs: [
      'Deep and soulful house all evening in {hood}. Rotating DJs, cheap drinks, friendly crowd that actually dances.',
      'Rooftop house session in {hood} from golden hour to close. Disco edits early, deeper cuts after dark. Sunset over the skyline included.',
      'House, disco, and boogie in a {hood} backyard. String lights, a proper soundsystem, and a grill going until midnight.',
    ],
    hashtags: ['house', 'disco', 'dance'], startHours: [18, 20, 21], durationH: [5, 6],
  },
  {
    key: 'jazz',
    titles: ['{hood} Jazz Session', 'Live Jazz at the {hood} Spot', 'Late-Night Jazz — {hood}'],
    descs: [
      'Live jazz trio in an intimate {hood} room. Standards first set, originals second. Come early for a seat, stay for the hang.',
      'Late-night jam session in {hood} — the house band opens, then the horn players in the crowd take over. Cheap wine, warm room.',
      'An evening of hard bop and soul jazz in {hood}. No cover, one-drink minimum, and the drummer never plays the same fill twice.',
    ],
    hashtags: ['jazz', 'livemusic'], startHours: [19, 20, 22], durationH: [3, 4],
  },
  {
    key: 'afrobeats',
    titles: ['Afrobeats Takeover: {hood}', '{hood} Amapiano Night', 'Afrobeats & Amapiano — {hood}'],
    descs: [
      'Afrobeats, amapiano, and dancehall all night in {hood}. High energy from the first song — bring your dancing shoes.',
      'The {hood} afrobeats party returns. Two rooms, live percussion over the DJ after midnight, jollof from the kitchen till late.',
    ],
    hashtags: ['afrobeats', 'amapiano', 'dancehall'], startHours: [21, 22], durationH: [5, 6],
  },
  {
    key: 'latin',
    titles: ['Salsa Social — {hood}', '{hood} Bachata Night', 'Latin Night in {hood}'],
    descs: [
      'Salsa social in {hood} with a beginner lesson at the top of the night. Live band second half, partner rotation, all levels welcome.',
      'Bachata and merengue in {hood} until 2am. Dominican kitchen open late, dance floor gets serious after midnight.',
      'Reggaeton and salsa dura in a {hood} basement spot. Small floor, big speakers, no attitude.',
    ],
    hashtags: ['salsa', 'bachata', 'latin'], startHours: [19, 20, 21], durationH: [4, 5],
  },
  {
    key: 'openmic',
    titles: ['Open Mic at the {hood} Basement', '{hood} Open Mic & Jam', 'Songwriters Round — {hood}'],
    descs: [
      'Open mic in {hood} — singers, rappers, poets, comics, everyone gets five minutes. Sign-up at the door, supportive room.',
      'Songwriter showcase in a {hood} listening room. Original material only, the audience actually listens, and the host keeps it moving.',
    ],
    hashtags: ['openmic', 'livemusic', 'poetry'], startHours: [19, 20], durationH: [3, 3],
  },
  {
    key: 'comedy',
    titles: ['{hood} Comedy Showcase', 'Stand-Up in the Back — {hood}', '{hood} Comedy Cellar Warmups'],
    descs: [
      'Eight comics, one mic, the back room of a {hood} bar. Lineup mixes club regulars with first-timers finding out live.',
      'Monthly stand-up showcase in {hood}. Two drink tickets with entry, headliner announced at the door, heckling costs you a round.',
    ],
    hashtags: ['comedy', 'standup'], startHours: [19, 20, 21], durationH: [2, 3],
  },
  {
    key: 'art',
    titles: ['Gallery Opening: {hood}', '{hood} Art Walk', 'Studio Crawl — {hood}'],
    descs: [
      'Opening night for a group show of {hood} painters and photographers. Free wine while it lasts, artists in the room, work actually for sale.',
      'Self-guided art walk through {hood} — six studios and two galleries open their doors for one evening. Start anywhere, maps at each stop.',
    ],
    hashtags: ['art', 'gallery'], startHours: [17, 18], durationH: [3, 4],
  },
  {
    key: 'food',
    titles: ['{hood} Night Market', 'Supper Club: {hood}', '{hood} Food Crawl'],
    descs: [
      'Night market in {hood} — a dozen vendors, string lights over a parking lot, dumplings, tacos, and skewers until they sell out.',
      'A 20-seat supper club in {hood}. Five courses from a rotating guest chef, communal table, menu revealed when you sit down.',
      'Progressive food crawl through {hood}: four stops, one bite and one drink at each, ending with dessert on a rooftop.',
    ],
    hashtags: ['food', 'nightmarket', 'foodie'], startHours: [17, 18, 19], durationH: [3, 4],
  },
  {
    key: 'film',
    titles: ['Rooftop Film Night — {hood}', '{hood} Short Film Screening', 'Movies in the Park: {hood}'],
    descs: [
      'Outdoor screening in {hood} with the skyline behind the screen. Blankets on the roof, popcorn included, film starts at dusk.',
      'A night of short films from {borough} filmmakers, screened in a {hood} community space. Q&A with the directors after.',
    ],
    hashtags: ['film', 'screening', 'movies'], startHours: [19, 20], durationH: [3, 3],
  },
  {
    key: 'fitness',
    titles: ['{hood} Morning Run Club', 'Sunrise Yoga — {hood}', 'Pickup Basketball: {hood}'],
    descs: [
      'Easy-pace 5k through {hood} — all levels, nobody gets dropped, coffee together after. Meet at the park entrance.',
      'Sunrise yoga in a {hood} park. Bring a mat and a layer, first-timers up front where the instructor can save them.',
      'Weekly pickup run in {hood} — first ten get on, winners stay, arguments settled by shooting for it.',
    ],
    hashtags: ['run', 'fitness', 'yoga', 'basketball'], startHours: [7, 8, 9], durationH: [1, 2],
  },
  {
    key: 'chill',
    titles: ['{hood} Park Picnic', 'Chess & Cold Brew — {hood}', '{hood} Book Club in the Park'],
    descs: [
      'Low-key picnic in the {hood} park — bring a dish or a blanket or both. Frisbee, a speaker at reasonable volume, zero agenda.',
      'Casual chess in {hood} — boards and clocks provided, all strengths, the coffee cart sponsors the winner.',
      'Outdoor book club in {hood}. This month is a short one so nobody has an excuse. Discussion for an hour, hanging out after.',
    ],
    hashtags: ['picnic', 'chess', 'books', 'chill'], startHours: [11, 12, 14], durationH: [2, 3],
  },
  {
    key: 'karaoke',
    titles: ['Karaoke Till Late — {hood}', '{hood} Karaoke Room Takeover'],
    descs: [
      'Private-room karaoke takeover in {hood}. Rooms grouped by chaos level, ballad room strictly enforced, soju by the bottle.',
      'Open-floor karaoke in a {hood} dive — the book is huge, the crowd is generous, and the bartender duets on request.',
    ],
    hashtags: ['karaoke', 'nightlife'], startHours: [20, 21], durationH: [3, 4],
  },
  {
    key: 'vinyl',
    titles: ['Vinyl Night: {hood}', '{hood} Record Fair & Listening Session'],
    descs: [
      'All-vinyl listening night in {hood} — bring a record, play a side. Hi-fi rig, dim lights, conversation at listening volume.',
      'Record fair by day, listening session by night in {hood}. Crates from a dozen local sellers, DJs spinning only what they bought that day.',
    ],
    hashtags: ['vinyl', 'records', 'listening'], startHours: [15, 19, 20], durationH: [3, 4],
  },
  {
    key: 'trivia',
    titles: ['{hood} Pub Trivia', 'Trivia Night: {hood} Edition'],
    descs: [
      'Six rounds of trivia in a {hood} bar — music round, picture round, and one round the host invents on the spot. Teams of up to six.',
      'Weekly trivia in {hood} where the categories are chaotic and the prize is the bar tab. Come early, the good tables go fast.',
    ],
    hashtags: ['trivia', 'bar'], startHours: [19, 20], durationH: [2, 2],
  },
  {
    key: 'poetry',
    titles: ['{hood} Poetry Slam', 'Verses & Vibes — {hood}'],
    descs: [
      'Monthly poetry slam in {hood} — three rounds, audience judges, winner takes the door. Open sign-up until the list fills.',
      'An evening of readings and live instrumentation in {hood}. Poets over lo-fi beats, dim lights, snaps encouraged.',
    ],
    hashtags: ['poetry', 'spokenword'], startHours: [19, 20], durationH: [2, 3],
  },
];

// ── host roster (idempotent upsert; @example.com survives seed cleanups) ─────
const HOSTS = [
  { username: 'miabk',        email: 'mia@example.com' },
  { username: 'omarnyc',      email: 'omar@example.com' },
  { username: 'priyaqueens',  email: 'priya@example.com' },
  { username: 'devonbx',      email: 'devon@example.com' },
  { username: 'leilasi',      email: 'leila@example.com' },
  { username: 'chrisheights', email: 'chris@example.com' },
  { username: 'sofiaridge',   email: 'sofia@example.com' },
  { username: 'kaiflushing',  email: 'kai@example.com' },
  { username: 'flogreen',     email: 'flo@example.com' },
  { username: 'basbushwick',  email: 'bas@example.com' },
  { username: 'ninaharlem',   email: 'nina@example.com' },
  { username: 'teodumbo',     email: 'teo@example.com' },
];

async function ensureHosts() {
  const hash = await bcrypt.hash('SeedHost123!', 10);
  const ids = [];
  for (const h of HOSTS) {
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, username, bio)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET username = users.username
       RETURNING id`,
      [h.email, hash, h.username, `Hosting parties around NYC. Say hi if you see me at one.`]
    );
    ids.push(rows[0].id);
  }
  return ids;
}

function buildEvent(hostIds, now) {
  const hood = pick(HOODS);
  const arch = pick(ARCHETYPES);
  // Titles and descriptions are index-paired variants of the archetype — pick
  // one index for both so "Park Picnic" never gets the chess description.
  const vi = Math.floor(rand() * arch.descs.length);
  const fill = (s) => s.replaceAll('{hood}', hood.name).replaceAll('{borough}', hood.borough);

  // Days out: 1–35, weighted toward the first two weeks and toward Fri/Sat.
  let daysOut = randInt(1, 35);
  if (rand() < 0.5) daysOut = randInt(1, 14);
  const date = new Date(now.getTime() + daysOut * 86400000);
  if (rand() < 0.45) {
    const dow = date.getDay();
    date.setDate(date.getDate() + ((5 + Math.round(rand()) - dow + 7) % 7)); // snap to Fri/Sat
  }
  const startHour = pick(arch.startHours);
  date.setHours(startHour, pick([0, 0, 30]), 0, 0);
  const end = new Date(date.getTime() + randInt(arch.durationH[0], arch.durationH[1]) * 3600000);

  return {
    host_id: pick(hostIds),
    title: fill(arch.titles[vi % arch.titles.length]),
    description: fill(arch.descs[vi]),
    latitude: +(hood.lat + (rand() - 0.5) * 0.008).toFixed(6),
    longitude: +(hood.lng + (rand() - 0.5) * 0.008).toFixed(6),
    address: `${randInt(20, 980)} ${pick(STREETS)}, ${hood.borough}, NY`,
    start_time: date.toISOString(),
    end_time: end.toISOString(),
    capacity: pick([null, null, 30, 50, 75, 100, 150]),
    hashtags: arch.hashtags,
  };
}

async function main() {
  const now = new Date();
  const events = [];
  const hostIds = DRY ? ['dry-run'] : await ensureHosts();
  for (let i = 0; i < COUNT; i++) events.push(buildEvent(hostIds, now));

  if (DRY) {
    for (const e of events.slice(0, 10)) {
      console.log(`${e.start_time.slice(0, 16)}  ${e.title}\n  ${e.description.slice(0, 90)}…\n  ${e.address}`);
    }
    console.log(`\n[dry-run] would insert ${events.length} events (seed=${SEED})`);
    return;
  }

  let inserted = 0;
  for (const e of events) {
    await db.query(
      `INSERT INTO events
         (host_id, title, description, location, latitude, longitude, address,
          start_time, end_time, capacity, hashtags, is_private, show_attendees)
       VALUES
         ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          $4, $5, $6, $7, $8, $9, $10, false, true)`,
      [e.host_id, e.title, e.description, e.latitude, e.longitude,
       e.address, e.start_time, e.end_time, e.capacity, e.hashtags]
    );
    inserted++;
  }

  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE start_time > now()) AS upcoming,
            count(*) FILTER (WHERE embedding IS NULL) AS needs_embedding
       FROM events WHERE status = 'active'`
  );
  console.log(`[seed] inserted ${inserted} events (seed=${SEED}) · upcoming now: ${rows[0].upcoming} · awaiting embedding: ${rows[0].needs_embedding}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seed] fatal:', err.message); process.exit(1); });
