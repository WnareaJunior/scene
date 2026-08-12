// Web v1 feed — read-only list of upcoming public parties (GET /events,
// the "discover" endpoint: paginated, chronological when no map viewport is
// sent). Native never imports this file; it has no map, no RSVP writes.
//
// Deliberately a ScrollView + map, not a FlatList: virtualization only mounts
// a window of rows, which makes "how many posts are on the page" depend on
// engine and viewport — the e2e suite counts DOM cards, and a few dozen light
// cards don't need recycling on web.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet,
} from 'react-native';
import { events } from '../api';
import { COLORS } from '../constants/colors';
import EventCard from '../components/EventCard';

const PAGE_SIZE = 20;
// Start fetching the next page when the reader is within this many px of the end.
const END_REACH_PX = 400;

export default function WebFeed() {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const pageRef = useRef(1);
  // Discover has no implicit "upcoming" filter — without startAfter the first
  // pages are long-expired parties. Pinned at mount so page offsets don't
  // shift between fetches.
  const startAfterRef = useRef(new Date().toISOString());

  // Append with id-dedup: events created between page fetches shift the
  // offset-based pages, and duplicate rows would collide on React keys.
  const appendRows = useCallback((rows) => {
    setItems((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return [...prev, ...rows.filter((e) => !seen.has(e.id))];
    });
    setHasMore(rows.length === PAGE_SIZE);
  }, []);

  useEffect(() => {
    let cancelled = false;
    events.discover({ page: 1, limit: PAGE_SIZE, startAfter: startAfterRef.current })
      .then((rows) => {
        if (cancelled) return;
        pageRef.current = 1;
        setItems(Array.isArray(rows) ? rows : []);
        setHasMore(Array.isArray(rows) && rows.length === PAGE_SIZE);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'could not load the feed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const rows = await events.discover({
        page: pageRef.current + 1,
        limit: PAGE_SIZE,
        startAfter: startAfterRef.current,
      });
      pageRef.current += 1;
      appendRows(Array.isArray(rows) ? rows : []);
    } catch {
      // Leave hasMore true — the footer button stays as a manual retry.
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, hasMore, appendRows]);

  const handleScroll = useCallback(({ nativeEvent }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - END_REACH_PX) {
      loadMore();
    }
  }, [loadMore]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error} testID="feed-error">{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      testID="feed-list"
      onScroll={handleScroll}
      scrollEventThrottle={100}
    >
      {items.length === 0 ? (
        <Text style={styles.empty} testID="feed-empty">
          nothing on the map yet — check back tonight
        </Text>
      ) : (
        items.map((item) => (
          <EventCard key={item.id} event={item} showHost testID="feed-post-card" />
        ))
      )}
      {loadingMore ? (
        <ActivityIndicator color={COLORS.accent} style={styles.footer} />
      ) : hasMore && items.length > 0 ? (
        // Explicit button alongside infinite scroll: deterministic for e2e
        // (B2) and a fallback if a browser never delivers the scroll events.
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={loadMore}
          testID="feed-load-more"
          accessibilityRole="button"
          accessibilityLabel="load more parties"
        >
          <Text style={styles.moreBtnText}>more parties</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: COLORS.errorRed, textAlign: 'center' },
  empty: { color: COLORS.inkSecondary, textAlign: 'center', marginTop: 48 },
  footer: { marginVertical: 20 },
  moreBtn: {
    marginTop: 8,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  moreBtnText: { color: COLORS.ink, fontWeight: '600', fontSize: 14 },
});
