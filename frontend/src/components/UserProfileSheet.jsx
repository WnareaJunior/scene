import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { users } from '../api';
import { COLORS } from '../constants/colors';
import BottomSheet from './BottomSheet';

const formatCount = (n) => {
  if (!n && n !== 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

const DEFAULT_DURATION_MS = 4 * 3600000;

function getEventState(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time
    ? new Date(event.end_time).getTime()
    : start + DEFAULT_DURATION_MS;
  if (now >= start && now <= end) return 'live';
  if (now < start) return 'upcoming';
  return 'past';
}

const STATE_COLORS = { live: COLORS.liveGreen, upcoming: COLORS.accent, past: COLORS.inkFaint };

function EventRow({ event }) {
  const state = getEventState(event);
  const date = new Date(event.start_time).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    <View style={styles.eventRow}>
      {event.image_url ? (
        <Image source={{ uri: event.image_url }} style={styles.eventImage} />
      ) : (
        <View style={styles.eventImagePlaceholder}>
          <Text style={styles.eventImageInitial}>{event.title?.[0] ?? '?'}</Text>
        </View>
      )}
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.eventDate}>{date}</Text>
        <View style={[styles.statePill, { borderColor: STATE_COLORS[state] }]}>
          <Text style={[styles.statePillText, { color: STATE_COLORS[state] }]}>
            {state}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function UserProfileSheet({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!userId) { setProfile(null); setEvents([]); return; }
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    setEvents([]);
    Promise.all([users.getUser(userId), users.userEvents(userId).catch(() => [])])
      .then(([prof, evts]) => {
        if (cancelled) return;
        setProfile(prof);
        setFollowing(prof?.is_following ?? false);
        setBlocked(prof?.is_blocked ?? false);
        setEvents(Array.isArray(evts) ? evts : []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setProfile((p) => p ? ({
      ...p,
      followers_count: (p.followers_count ?? 0) + (wasFollowing ? -1 : 1),
    }) : p);
    setFollowLoading(true);
    try {
      if (wasFollowing) await users.unfollow(userId);
      else await users.follow(userId);
    } catch {
      setFollowing(wasFollowing);
      setProfile((p) => p ? ({
        ...p,
        followers_count: (p.followers_count ?? 0) + (wasFollowing ? 1 : -1),
      }) : p);
    } finally {
      setFollowLoading(false);
    }
  }, [following, profile, userId]);

  const handleBlock = useCallback(() => {
    if (blocked) {
      users.unblock(userId).then(() => setBlocked(false)).catch(() => {});
      return;
    }
    Alert.alert(`block @${profile?.username}?`, 'their parties disappear from your map and feed. they wont know.', [
      { text: 'nevermind', style: 'cancel' },
      {
        text: 'block',
        style: 'destructive',
        onPress: () => {
          users.block(userId).then(() => { setBlocked(true); setFollowing(false); }).catch(() => {});
        },
      },
    ]);
  }, [blocked, userId, profile?.username]);

  const handleReport = useCallback(() => {
    const send = (reason) => {
      users.report(userId, reason).catch(() => {});
      Alert.alert('got it', "thanks — we'll take a look.");
    };
    Alert.alert(`report @${profile?.username}?`, "tell us what's wrong.", [
      { text: 'nevermind', style: 'cancel' },
      { text: 'fake or spam account', onPress: () => send('fake or spam account') },
      { text: 'offensive or unsafe', onPress: () => send('offensive or unsafe') },
    ]);
  }, [userId, profile?.username]);

  const ListHeader = useCallback(() => (
    <View style={styles.header}>
      {/* Avatar */}
      {profile?.profile_picture ? (
        <Image
          source={{ uri: profile.profile_picture }}
          style={styles.avatar}
          accessibilityLabel={`${profile?.username}'s profile picture`}
        />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitial}>
            {profile?.username?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      {/* Name + bio + stats + follow. Bio only — never fall back to the
          account email; that leaks private data on a public surface. */}
      <View style={styles.headerInfo}>
        <Text style={styles.name}>{profile?.username}</Text>
        {profile?.bio ? (
          <Text style={styles.bio} numberOfLines={2}>{profile.bio}</Text>
        ) : null}
        <View style={styles.statsRow}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profile?.following_count)}</Text> following
          </Text>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profile?.followers_count)}</Text> followers
          </Text>
        </View>
        <View style={styles.actionRow}>
          {!blocked && (
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followBtnActive]}
              onPress={toggleFollow}
              disabled={followLoading}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={following ? `unfollow ${profile?.username}` : `follow ${profile?.username}`}
            >
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
                {following ? 'following' : 'follow'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.quietBtn}
            onPress={handleBlock}
            accessibilityRole="button"
            accessibilityLabel={blocked ? `unblock ${profile?.username}` : `block ${profile?.username}`}
          >
            <Text style={styles.quietBtnText}>{blocked ? 'unblock' : 'block'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quietBtn}
            onPress={handleReport}
            accessibilityRole="button"
            accessibilityLabel={`report ${profile?.username}`}
          >
            <Text style={styles.quietBtnText}>report</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  ), [profile, following, followLoading, toggleFollow, blocked, handleBlock, handleReport]);

  return (
    <BottomSheet visible={userId !== null} onClose={onClose} maxHeight="85%">
      <TouchableOpacity
        style={styles.closeBtn}
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="close profile"
      >
        <Text style={styles.closeBtnText}>✕</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={COLORS.accent} style={{ marginTop: 40, marginBottom: 40 }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => <EventRow event={item} />}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            profile ? <Text style={styles.empty}>no parties yet</Text> : null
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  closeBtn: { position: 'absolute', top: 14, right: 16, zIndex: 10 },
  closeBtnText: { color: COLORS.inkSecondary, fontSize: 18 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', paddingTop: 8, paddingBottom: 20, gap: 14 },
  avatar: { width: 72, height: 72, backgroundColor: COLORS.card },
  avatarPlaceholder: {
    width: 72, height: 72,
    backgroundColor: COLORS.accentTint,
    borderWidth: 2, borderColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.accent, fontSize: 28, fontWeight: '700' },
  headerInfo: { flex: 1 },
  name: { color: COLORS.ink, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  bio: { color: COLORS.inkSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  statText: { color: COLORS.inkSecondary, fontSize: 13 },
  statNumber: { color: COLORS.ink, fontWeight: '700' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quietBtn: { minHeight: 44, justifyContent: 'center' },
  quietBtnText: { color: COLORS.inkSecondary, fontSize: 13, fontWeight: '600' },
  followBtn: {
    backgroundColor: COLORS.accent,
    minHeight: 44, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.accent },
  followBtnText: { color: COLORS.accentInk, fontSize: 14, fontWeight: '600' },
  followBtnTextActive: { color: COLORS.accent },

  eventRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  eventImage: { width: 64, height: 64, backgroundColor: COLORS.card },
  eventImagePlaceholder: {
    width: 64, height: 64,
    backgroundColor: COLORS.divider, alignItems: 'center', justifyContent: 'center',
  },
  eventImageInitial: { color: COLORS.inkFaint, fontSize: 24, fontWeight: '700' },
  eventInfo: { flex: 1, justifyContent: 'center' },
  eventTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '600', marginBottom: 3 },
  eventDate: { color: COLORS.inkSecondary, fontSize: 12, marginBottom: 6 },
  statePill: {
    alignSelf: 'flex-start', borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  statePillText: { fontSize: 11, fontWeight: '600' },
  empty: { color: COLORS.inkSecondary, textAlign: 'center', marginTop: 24 },
});
