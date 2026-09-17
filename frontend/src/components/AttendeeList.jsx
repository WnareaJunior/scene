import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { events as eventsApi } from '../api';
import { COLORS } from '../constants/colors';

// How many avatars the collapsed face pile shows before "+N".
const PILE_SIZE = 6;
// One page of the expanded list. The endpoint caps limit at 100.
const PAGE = 20;

function Avatar({ uri, username, size, style }) {
  if (uri) {
    return <Image source={{ uri }} style={[{ width: size, height: size }, styles.avatar, style]} />;
  }
  return (
    <View style={[{ width: size, height: size }, styles.avatar, styles.avatarPlaceholder, style]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>
        {username?.[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

/**
 * Who's coming, under the capacity row on the event sheet.
 *
 * Collapsed it is a face pile; tapping expands an inline list rather than
 * opening a second sheet — a Modal inside the event Modal fights the parent's
 * pan-to-dismiss and loses on iOS.
 *
 * The endpoint answers 403 when the host has turned show_attendees off, so a
 * refused list is a normal state here, not an error to retry.
 */
export default function AttendeeList({ eventId, goingCount = 0, onUserPress }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hidden, setHidden] = useState(false);   // host turned the list off
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (offset, limit) => {
    const req = ++reqRef.current;
    try {
      const res = await eventsApi.attendees(eventId, { limit, offset });
      if (req !== reqRef.current) return;          // a newer load won
      setRows((prev) => (offset ? [...prev, ...(res.data ?? [])] : (res.data ?? [])));
      setTotal(res.total ?? 0);
      setHidden(false);
      setFailed(false);
    } catch (err) {
      if (req !== reqRef.current) return;
      if (err?.status === 403) setHidden(true);
      else setFailed(true);
    } finally {
      if (req === reqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [eventId]);

  // Refetch when the going count moves: the viewer's own RSVP lands here, and
  // the parent re-renders with a new count rather than telling us directly.
  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setExpanded(false);
    load(0, PILE_SIZE);
  }, [eventId, goingCount, load]);

  const onExpand = () => {
    setExpanded(true);
    // The pile only fetched PILE_SIZE rows; pull a full page behind the reveal.
    if (rows.length < Math.min(total, PAGE)) {
      setLoadingMore(true);
      load(0, PAGE);
    }
  };

  const onLoadMore = () => {
    setLoadingMore(true);
    load(rows.length, PAGE);
  };

  if (loading) {
    return (
      <View style={styles.quietRow}>
        <ActivityIndicator size="small" color={COLORS.inkFaint} />
      </View>
    );
  }

  if (hidden) {
    return (
      <View style={styles.quietRow}>
        <Text style={styles.quietText}>the host keeps the guest list private</Text>
      </View>
    );
  }

  // A failed fetch stays quiet. The count is already on screen above this, so
  // an error banner here would be louder than what it is telling you.
  if (failed) return null;

  if (total === 0) {
    return (
      <View style={styles.quietRow}>
        <Text style={styles.quietText}>
          {goingCount > 0 ? 'no one to show yet' : "no one's going yet — be first"}
        </Text>
      </View>
    );
  }

  if (!expanded) {
    const pile = rows.slice(0, PILE_SIZE);
    const more = total - pile.length;
    return (
      <TouchableOpacity
        style={styles.pileRow}
        onPress={onExpand}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`see who's coming, ${total} ${total === 1 ? 'person' : 'people'}`}
      >
        <View style={styles.pile}>
          {pile.map((u, i) => (
            <Avatar
              key={u.id}
              uri={u.profile_picture}
              username={u.username}
              size={28}
              style={[styles.pileAvatar, i > 0 && styles.pileAvatarOverlap]}
            />
          ))}
          {more > 0 && (
            <View style={[styles.avatar, styles.pileCount, styles.pileAvatarOverlap]}>
              <Text style={styles.pileCountText}>+{more}</Text>
            </View>
          )}
        </View>
        <Text style={styles.pileLabel}>who's coming ›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.list}>
      <View style={styles.listHead}>
        <Text style={styles.listTitle}>
          who's coming · {total}
        </Text>
        <TouchableOpacity
          onPress={() => setExpanded(false)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="hide the guest list"
        >
          <Text style={styles.collapse}>hide</Text>
        </TouchableOpacity>
      </View>

      {rows.map((u) => (
        <TouchableOpacity
          key={u.id}
          style={styles.row}
          onPress={() => onUserPress?.(u.id)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`@${u.username}, ${u.rsvp_status}, view profile`}
        >
          <Avatar uri={u.profile_picture} username={u.username} size={32} />
          <Text style={styles.rowName} numberOfLines={1}>@{u.username}</Text>
          {u.rsvp_status === 'interested' && (
            <Text style={styles.maybe}>maybe</Text>
          )}
        </TouchableOpacity>
      ))}

      {rows.length < total && (
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={onLoadMore}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityLabel={`load more of the guest list, ${total - rows.length} remaining`}
        >
          <Text style={styles.moreBtnText}>
            {loadingMore ? 'loading…' : `show ${total - rows.length} more`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  quietRow: { paddingHorizontal: 16, marginTop: 10, minHeight: 20, justifyContent: 'center' },
  quietText: { color: COLORS.inkSecondary, fontSize: 13 },

  avatar: { backgroundColor: COLORS.card },
  avatarPlaceholder: {
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.inkSecondary, fontWeight: '700' },

  pileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, marginTop: 12, minHeight: 44,
  },
  pile: { flexDirection: 'row', alignItems: 'center' },
  pileAvatar: { borderWidth: 1, borderColor: COLORS.asphalt },
  pileAvatarOverlap: { marginLeft: -8 },
  pileCount: {
    width: 28, height: 28,
    borderWidth: 1, borderColor: COLORS.asphalt,
    alignItems: 'center', justifyContent: 'center',
  },
  pileCountText: { color: COLORS.inkSecondary, fontSize: 11, fontWeight: '700' },
  pileLabel: { color: COLORS.inkSecondary, fontSize: 13 },

  list: {
    marginTop: 12, marginHorizontal: 16,
    borderTopWidth: 1, borderTopColor: COLORS.divider,
  },
  listHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, paddingBottom: 4,
  },
  listTitle: { color: COLORS.inkSecondary, fontSize: 13, fontWeight: '600' },
  collapse: { color: COLORS.inkSecondary, fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 44,
  },
  rowName: { color: COLORS.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  maybe: { color: COLORS.inkFaint, fontSize: 11, marginLeft: 'auto' },

  moreBtn: { minHeight: 44, justifyContent: 'center' },
  moreBtnText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
});
