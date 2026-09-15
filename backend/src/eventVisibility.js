// One definition of "may this viewer see this event", shared by every query
// that lists or fetches events.
//
// Private used to mean host-only-plus-going-attendees, and the rule was written
// out by hand in six places: the discover list, the feed, map pins, a profile's
// events, the search hard filters, and a partial index. Six copies of a
// visibility rule is five chances to leak a private party, so it lives here now
// and each call site interpolates it.
//
// A private event is visible to:
//   - its host
//   - anyone following the host   (the "invite your circle" case)
//   - anyone already RSVP'd       (never revoke access from someone going)
//
// Deliberately NOT here: access by invite link. That is possession of a token
// rather than a fact about the viewer, so it belongs on the single-event fetch
// and not in a list predicate — a link should reach one party, not unlock a
// stranger's private events across the whole map. It ships with the share-link
// work.

const db = require('./db');

/**
 * SQL predicate string for event visibility.
 *
 * `viewerParam` is a placeholder this codebase constructs ($1, $5, or whatever
 * the query builder hands back) — never a value and never user input, so it is
 * safe to interpolate. `alias` is the events table alias in the caller's query.
 */
function eventVisibilitySql(viewerParam, alias = 'e') {
  return `(
    ${alias}.is_private = false
    OR ${alias}.host_id = ${viewerParam}
    OR EXISTS (
      SELECT 1 FROM follows f
       WHERE f.follower_id = ${viewerParam} AND f.followed_id = ${alias}.host_id
    )
    OR EXISTS (
      SELECT 1 FROM rsvps rv
       WHERE rv.event_id = ${alias}.id AND rv.user_id = ${viewerParam}
    )
  )`;
}

/**
 * The same rule for a single event already loaded in memory.
 *
 * Used by the routes that fetch one event and then decide, where re-running the
 * list predicate would mean a second full query. Returns false for a missing
 * event so callers answer 404 rather than confirming it exists.
 */
async function canSeeEvent(event, viewerId) {
  if (!event) return false;
  if (!event.is_private || event.host_id === viewerId) return true;

  const { rows } = await db.query(
    `SELECT 1
      WHERE EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2)
         OR EXISTS (SELECT 1 FROM rsvps   WHERE event_id = $3   AND user_id = $1)`,
    [viewerId, event.host_id, event.id]
  );
  return rows.length > 0;
}

module.exports = { eventVisibilitySql, canSeeEvent };
