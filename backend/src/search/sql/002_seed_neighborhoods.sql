-- Seed data for the stage-2 location dictionary (blocker #2).
--
-- ⚠️  NOT AUTO-APPLIED. Run by hand after 001_search_schema.sql, same as that
--     file. Idempotent on `slug`, so re-running updates rather than duplicating.
--
-- Scope: NYC only. The app already falls back to NYC on first load when nothing
-- is nearby, so that is the launch city. Add a second city by appending rows
-- with the same shape — nothing in the parser is NYC-specific.
--
-- ⚠️  COORDINATES ARE APPROXIMATE CENTROIDS and have not been verified against a
--     survey source. They are close enough that ST_DWithin scoping behaves
--     sensibly, but spot-check the ones you care about before launch — a
--     centroid that is a few hundred metres off silently skews every geo-scoped
--     search for that neighborhood. The `boundary` column in 001 is the real
--     fix: when you have polygons, populate it and prefer ST_Within, because
--     neighborhoods are not circles and a radius around Williamsburg's centroid
--     reaches into three others.
--
-- On `default_radius_m`: this is the search radius applied when a query names
-- the place. It is deliberately generous — larger than the neighborhood itself —
-- because someone searching "bushwick" will happily walk ten minutes to a party
-- just over the line in Ridgewood. Tighten it only if results feel diluted.
--
-- On aliases: these are the colloquial forms people actually type. They are
-- matched as whole tokens, case-insensitively, longest-first. Do not add an
-- alias shorter than 2 characters, and avoid aliases that are common English
-- words — "the village" is fine, "east" is not, because it would swallow half
-- the query and geo-scope searches that were never about a place.

INSERT INTO neighborhoods (name, slug, aliases, city, region, country, latitude, longitude, default_radius_m)
VALUES
  -- ── Brooklyn — north ──────────────────────────────────────────────────────
  ('Williamsburg',        'williamsburg',    ARRAY['wburg','w burg','the burg','billyburg'],  'New York', 'NY', 'US', 40.7081, -73.9571, 2200),
  ('East Williamsburg',   'east-williamsburg', ARRAY['east wburg'],                           'New York', 'NY', 'US', 40.7126, -73.9330, 1800),
  ('Greenpoint',          'greenpoint',      ARRAY['gpoint','g point'],                       'New York', 'NY', 'US', 40.7304, -73.9540, 2000),
  ('Bushwick',            'bushwick',        ARRAY['bwick'],                                  'New York', 'NY', 'US', 40.6944, -73.9213, 2600),
  ('Bedford-Stuyvesant',  'bed-stuy',        ARRAY['bed stuy','bedstuy','bed-stuy','stuy'],   'New York', 'NY', 'US', 40.6872, -73.9418, 2600),
  ('Fort Greene',         'fort-greene',     ARRAY['ft greene'],                              'New York', 'NY', 'US', 40.6892, -73.9743, 1600),
  ('Clinton Hill',        'clinton-hill',    ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.6896, -73.9661, 1500),
  ('Crown Heights',       'crown-heights',   ARRAY['crown hts'],                              'New York', 'NY', 'US', 40.6694, -73.9422, 2400),
  ('DUMBO',               'dumbo',           ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7033, -73.9881, 1100),
  ('Downtown Brooklyn',   'downtown-brooklyn', ARRAY['dtbk','downtown bk'],                   'New York', 'NY', 'US', 40.6939, -73.9865, 1600),

  -- ── Brooklyn — south / west ───────────────────────────────────────────────
  ('Park Slope',          'park-slope',      ARRAY['the slope','slope'],                      'New York', 'NY', 'US', 40.6710, -73.9814, 2000),
  ('Gowanus',             'gowanus',         ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.6736, -73.9895, 1500),
  ('Red Hook',            'red-hook',        ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.6743, -74.0093, 1700),
  ('Sunset Park',         'sunset-park',     ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.6455, -74.0122, 2200),
  ('Prospect Heights',    'prospect-heights', ARRAY['pro hts'],                               'New York', 'NY', 'US', 40.6774, -73.9668, 1500),

  -- ── Manhattan — downtown ──────────────────────────────────────────────────
  ('Lower East Side',     'lower-east-side', ARRAY['les','the les'],                          'New York', 'NY', 'US', 40.7180, -73.9880, 1600),
  ('East Village',        'east-village',    ARRAY['ev','the ev'],                            'New York', 'NY', 'US', 40.7265, -73.9815, 1500),
  ('West Village',        'west-village',    ARRAY['the village'],                            'New York', 'NY', 'US', 40.7358, -74.0036, 1500),
  ('SoHo',                'soho',            ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7233, -74.0030, 1300),
  ('Nolita',              'nolita',          ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7220, -73.9955, 1000),
  ('Tribeca',             'tribeca',         ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7163, -74.0086, 1300),
  ('Chinatown',           'chinatown',       ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7158, -73.9970, 1300),
  ('Financial District',  'fidi',            ARRAY['fidi'],                                   'New York', 'NY', 'US', 40.7075, -74.0113, 1400),

  -- ── Manhattan — midtown / uptown ──────────────────────────────────────────
  ('Chelsea',             'chelsea',         ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7465, -74.0014, 1700),
  ('Flatiron',            'flatiron',        ARRAY['union square','union sq'],                'New York', 'NY', 'US', 40.7401, -73.9903, 1400),
  ('Hell''s Kitchen',     'hells-kitchen',   ARRAY['hells kitchen','hk','clinton'],           'New York', 'NY', 'US', 40.7638, -73.9918, 1800),
  ('Midtown',             'midtown',         ARRAY['midtown manhattan'],                      'New York', 'NY', 'US', 40.7549, -73.9840, 2000),
  ('Harlem',              'harlem',          ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.8116, -73.9465, 2800),
  ('Upper East Side',     'upper-east-side', ARRAY['ues'],                                    'New York', 'NY', 'US', 40.7736, -73.9566, 2400),
  ('Upper West Side',     'upper-west-side', ARRAY['uws'],                                    'New York', 'NY', 'US', 40.7870, -73.9754, 2400),

  -- ── Queens ────────────────────────────────────────────────────────────────
  ('Bushwick/Ridgewood',  'ridgewood',       ARRAY['ridgewood'],                              'New York', 'NY', 'US', 40.7045, -73.9027, 2200),
  ('Astoria',             'astoria',         ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7644, -73.9235, 2600),
  ('Long Island City',    'long-island-city', ARRAY['lic'],                                   'New York', 'NY', 'US', 40.7447, -73.9485, 2000),

  -- ── Boroughs ──────────────────────────────────────────────────────────────
  -- Deliberately wide. "parties in brooklyn" should not be scoped to a
  -- neighborhood-sized circle around the borough's centroid.
  ('Brooklyn',            'brooklyn',        ARRAY['bk','bklyn'],                             'New York', 'NY', 'US', 40.6782, -73.9442, 9000),
  ('Manhattan',           'manhattan',       ARRAY['the city','nyc'],                         'New York', 'NY', 'US', 40.7580, -73.9855, 8000),
  ('Queens',              'queens',          ARRAY[]::text[],                                 'New York', 'NY', 'US', 40.7282, -73.7949, 11000)

ON CONFLICT (slug) DO UPDATE SET
  name             = EXCLUDED.name,
  aliases          = EXCLUDED.aliases,
  latitude         = EXCLUDED.latitude,
  longitude        = EXCLUDED.longitude,
  default_radius_m = EXCLUDED.default_radius_m,
  is_active        = true;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Run these after seeding. Both should return rows; if the second returns
-- nothing, pg_trgm is missing or the extension didn't install.

-- SELECT count(*) AS seeded FROM neighborhoods WHERE is_active;

-- Typo tolerance — should match Williamsburg above the 0.45 threshold in
-- config.js (LOCATION_MATCH_THRESHOLD).
-- SELECT name, similarity(name, 'willaimsburg') AS sim
--   FROM neighborhoods
--  WHERE similarity(name, 'willaimsburg') >= 0.45
--  ORDER BY sim DESC;

-- Alias collision check — an alias that matches more than one row will make
-- location parsing non-deterministic. This should return zero rows.
-- SELECT a AS alias, count(*), array_agg(name) AS claimed_by
--   FROM neighborhoods n, unnest(n.aliases) AS a
--  WHERE n.is_active
--  GROUP BY a HAVING count(*) > 1;
