import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { users, auth, clearTokens } from '../api';

function getEventState(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time ? new Date(event.end_time).getTime() : null;
  if (end && now >= start && now <= end) return 'live';
  if (now < start) return 'upcoming';
  return 'past';
}

function formatEventDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATE_COLORS = { live: '#22c55e', upcoming: '#a855f7', past: '#555' };
const STATE_LABELS = { live: 'Live', upcoming: 'Upcoming', past: 'Past' };

function EventRow({ item }) {
  const state = getEventState(item);
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventRowLeft}>
        <Text style={styles.eventRowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.eventRowMeta}>
          {formatEventDate(item.start_time)}
          {item.address ? ` · ${item.address}` : ''}
        </Text>
      </View>
      <View style={styles.eventRowRight}>
        {item.source === 'hosting' && (
          <Text style={styles.hostingLabel}>Hosting</Text>
        )}
        <View style={[styles.badge, { borderColor: STATE_COLORS[state] }]}>
          <Text style={[styles.badgeText, { color: STATE_COLORS[state] }]}>
            {STATE_LABELS[state]}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function ProfileScreen({ user, onSignOut }) {
  const [profileData, setProfileData] = useState(user);
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    users.me().then((d) => { if (d?.id) setProfileData(d); }).catch(() => {});

    Promise.all([users.hostedEvents(), users.myRsvps()])
      .then(([hosted, rsvps]) => {
        const map = new Map();
        (hosted ?? []).forEach((e) => map.set(e.id, { ...e, source: 'hosting' }));
        (rsvps ?? []).forEach((e) => { if (!map.has(e.id)) map.set(e.id, { ...e, source: 'rsvp' }); });
        const sorted = [...map.values()].sort(
          (a, b) => new Date(b.start_time) - new Date(a.start_time)
        );
        setFeed(sorted);
      })
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    await auth.logout();
    await clearTokens();
    onSignOut();
  }

  return (
    <SafeAreaView style={styles.safeContent}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventRow item={item} />}
        ListHeaderComponent={
          <>
            <Text style={styles.screenTitle}>profile</Text>
            <View style={styles.profileCard}>
              <Text style={styles.profileName}>{profileData?.username}</Text>
              <Text style={styles.profileEmail}>{profileData?.email}</Text>
              {profileData?.bio ? <Text style={styles.profileBio}>{profileData.bio}</Text> : null}
              <View style={styles.profileStats}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{profileData?.followers_count ?? 0}</Text>
                  <Text style={styles.statLabel}>followers</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{profileData?.following_count ?? 0}</Text>
                  <Text style={styles.statLabel}>following</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
            {feed.length > 0 && <Text style={styles.feedTitle}>your events</Text>}
          </>
        }
        ListEmptyComponent={<Text style={styles.feedEmpty}>No events yet</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContent: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 40 },
  screenTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20, marginTop: 16 },
  profileCard: {
    backgroundColor: '#1a1a1a', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#2a2a2a',
  },
  profileName: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  profileEmail: { color: '#666', fontSize: 14, marginBottom: 10 },
  profileBio: { color: '#aaa', fontSize: 15, marginBottom: 16 },
  profileStats: { flexDirection: 'row', gap: 24 },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statLabel: { color: '#555', fontSize: 12 },
  signOutBtn: {
    marginTop: 12, backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  signOutText: { color: '#ef4444', fontWeight: '600' },
  feedTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 12 },
  feedEmpty: { color: '#444', textAlign: 'center', marginTop: 32 },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  eventRowLeft: { flex: 1, marginRight: 12 },
  eventRowTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  eventRowMeta: { color: '#555', fontSize: 12 },
  eventRowRight: { alignItems: 'flex-end', gap: 4 },
  hostingLabel: { color: '#a855f7', fontSize: 11, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
});
