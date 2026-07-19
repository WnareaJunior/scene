import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, FlatList,
} from 'react-native';
import { users } from '../api';

const formatCount = (n) => {
  if (!n && n !== 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

function getEventState(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time ? new Date(event.end_time).getTime() : null;
  if (end && now >= start && now <= end) return 'live';
  if (now < start) return 'upcoming';
  return 'past';
}

const STATE_COLORS = { live: '#22c55e', upcoming: '#ffa028', past: '#555' };
const STATE_LABELS = { live: 'Live', upcoming: 'Upcoming', past: 'Past' };

function EventRow({ event }) {
  const state = getEventState(event);
  const date = new Date(event.start_time).toLocaleDateString('en-US', {
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
            {STATE_LABELS[state]}
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

  const ListHeader = useCallback(() => (
    <View style={styles.header}>
      {/* Avatar */}
      {profile?.profile_picture ? (
        <Image source={{ uri: profile.profile_picture }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitial}>
            {profile?.username?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      {/* Name + bio + stats + follow */}
      <View style={styles.headerInfo}>
        <Text style={styles.name}>{profile?.username}</Text>
        {(profile?.bio || profile?.email) ? (
          <Text style={styles.bio} numberOfLines={2}>
            {profile.bio || profile.email}
          </Text>
        ) : null}
        <View style={styles.statsRow}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profile?.following_count)}</Text> Following
          </Text>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profile?.followers_count)}</Text> Followers
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.followBtn, following && styles.followBtnActive]}
          onPress={toggleFollow}
          disabled={followLoading}
          activeOpacity={0.8}
        >
          <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
            {following ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [profile, following, followLoading, toggleFollow]);

  return (
    <Modal
      visible={userId !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color="#ffa028" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={events}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => <EventRow event={item} />}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={
              profile ? <Text style={styles.empty}>No events yet</Text> : null
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  handle: {
    width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#444',
    alignSelf: 'center',
    marginVertical: 12,
  },
  closeBtn: { position: 'absolute', top: 14, right: 16 },
  closeBtnText: { color: '#666', fontSize: 18 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', paddingTop: 8, paddingBottom: 20, gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#333' },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#2b1d0a',
    borderWidth: 2, borderColor: '#ffa028',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#ffa028', fontSize: 28, fontWeight: '700' },
  headerInfo: { flex: 1 },
  name: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  bio: { color: '#8e8e93', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  statText: { color: '#8e8e93', fontSize: 13 },
  statNumber: { color: '#fff', fontWeight: '700' },
  followBtn: {
    backgroundColor: '#ffa028', borderRadius: 8,
    paddingVertical: 7, paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ffa028' },
  followBtnText: { color: '#1a0d00', fontSize: 14, fontWeight: '600' },
  followBtnTextActive: { color: '#ffa028' },

  eventRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1c1c1e' },
  eventImage: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#222' },
  eventImagePlaceholder: {
    width: 64, height: 64, borderRadius: 8,
    backgroundColor: '#1c1c1e', alignItems: 'center', justifyContent: 'center',
  },
  eventImageInitial: { color: '#555', fontSize: 24, fontWeight: '700' },
  eventInfo: { flex: 1, justifyContent: 'center' },
  eventTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  eventDate: { color: '#8e8e93', fontSize: 12, marginBottom: 6 },
  statePill: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  statePillText: { fontSize: 11, fontWeight: '600' },
  empty: { color: '#444', textAlign: 'center', marginTop: 24 },
});
