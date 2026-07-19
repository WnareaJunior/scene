import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { users, auth } from '../api';
import UserProfileSheet from '../components/UserProfileSheet';

// ============================================================================
// Helpers
// ============================================================================
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

// ============================================================================
// Subcomponents
// ============================================================================
const ProfileHeader = ({ profileData, onAvatarPress, onFollowingPress, onFollowersPress }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.8} style={styles.avatarWrap}>
      {profileData?.profile_picture ? (
        <Image
          source={{ uri: profileData.profile_picture, cache: 'reload' }}
          style={styles.avatar}
        />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitial}>
            {profileData?.username?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
      <View style={styles.avatarEdit}>
        <Text style={styles.avatarEditText}>+</Text>
      </View>
    </TouchableOpacity>

    <View style={styles.headerInfo}>
      <Text style={styles.name}>{profileData?.username}</Text>
      {profileData?.bio ? (
        <Text style={styles.bio}>{profileData.bio}</Text>
      ) : (
        <Text style={styles.bio}>{profileData?.email}</Text>
      )}
      <View style={styles.statsRow}>
        <TouchableOpacity onPress={onFollowingPress} activeOpacity={0.7}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profileData?.following_count)}</Text> Following
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onFollowersPress} activeOpacity={0.7}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(profileData?.followers_count)}</Text> Followers
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
);

const StatusBadge = ({ status }) => {
  if (!status) return null;
  const isHosting = status === 'hosting';
  return (
    <View style={[styles.badge, isHosting ? styles.badgeHosting : styles.badgeGoing]}>
      <Text style={[styles.badgeText, isHosting ? styles.badgeTextHosting : styles.badgeTextGoing]}>
        {isHosting ? 'Hosting' : 'Going'}
      </Text>
    </View>
  );
};

const STATE_COLORS = { live: '#22c55e', upcoming: '#ffa028', past: '#555' };
const STATE_LABELS = { live: 'Live', upcoming: 'Upcoming', past: 'Past' };

const ProfileEventCard = ({ event, profileData }) => {
  const state = getEventState(event);
  const status = event.source === 'hosting' ? 'hosting' : 'going';
  const formattedDate = new Date(event.start_time).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={styles.eventCard}>
      {/* Host row */}
      <View style={styles.hostRow}>
        <View style={styles.hostInfo}>
          {profileData?.profile_picture ? (
            <Image source={{ uri: profileData.profile_picture }} style={styles.hostAvatar} />
          ) : (
            <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
              <Text style={styles.hostAvatarInitial}>
                {profileData?.username?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <Text style={styles.hostName}>{profileData?.username}</Text>
        </View>
        <StatusBadge status={status} />
      </View>

      {/* Event image + details */}
      <View>
        {event.image_url ? (
          <Image source={{ uri: event.image_url }} style={styles.eventImage} />
        ) : (
          <View style={styles.eventImagePlaceholder}>
            <Text style={styles.eventImagePlaceholderText}>{event.title?.[0] ?? '?'}</Text>
          </View>
        )}
        <View style={styles.eventDetails}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <Text style={styles.eventLocation}>
            {event.address ?? formattedDate}
            {event.address ? `  ·  ${formattedDate}` : ''}
          </Text>
          <View style={[styles.statePill, { borderColor: STATE_COLORS[state] }]}>
            <Text style={[styles.statePillText, { color: STATE_COLORS[state] }]}>
              {STATE_LABELS[state]}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

// ============================================================================
// Main screen
// ============================================================================
export default function ProfileScreen({ user, onSignOut, refreshKey = 0 }) {
  const [profileData, setProfileData] = useState(user);
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(null);
  const [listSheet, setListSheet] = useState(null); // null | 'followers' | 'following'
  const [listData, setListData] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [viewingUserId, setViewingUserId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    users.me()
      .then((d) => { if (!cancelled && d?.id) setProfileData(d); })
      .catch((err) => {
        if (cancelled) return;
        // Profile refresh failure is non-blocking — the user already has cached
        // data from login. Show a subtle alert rather than crashing the screen.
        Alert.alert("couldn't refresh your profile", 'showing the last saved version — try again in a bit.');
      });

    setFeedLoading(true);
    setFeedError(null);
    Promise.all([users.hostedEvents(), users.myRsvps()])
      .then(([hosted, rsvps]) => {
        if (cancelled) return;
        const map = new Map();
        (hosted ?? []).forEach((e) => map.set(e.id, { ...e, source: 'hosting' }));
        (rsvps ?? []).forEach((e) => { if (!map.has(e.id)) map.set(e.id, { ...e, source: 'rsvp' }); });
        const sorted = [...map.values()].sort(
          (a, b) => new Date(b.start_time) - new Date(a.start_time)
        );
        setFeed(sorted);
      })
      .catch((err) => {
        if (!cancelled) setFeedError(err.message || 'Could not load your events.');
      })
      .finally(() => { if (!cancelled) setFeedLoading(false); });

    return () => { cancelled = true; };
  }, [refreshKey]);

  const openList = useCallback(async (type) => {
    if (!profileData?.id) return;
    setListSheet(type);
    setListData([]);
    setListLoading(true);
    try {
      const data = type === 'followers'
        ? await users.followers(profileData.id)
        : await users.following(profileData.id);
      setListData(Array.isArray(data) ? data : []);
    } catch {
      setListData([]);
    } finally {
      setListLoading(false);
    }
  }, [profileData?.id]);

  const closeList = useCallback(() => setListSheet(null), []);

  const handlePickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'photos access needed',
        'allow photo access in Settings to change your picture.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;
    try {
      const updated = await users.uploadAvatar(result.assets[0].uri);
if (updated?.id) setProfileData((prev) => ({ ...prev, profile_picture: updated.profile_picture }));
    } catch (err) {
      Alert.alert("photo didn't upload", err.message || 'try a different photo, or try again.');
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    // auth.logout() calls the server revoke endpoint AND clears tokens locally.
    await auth.logout();
    onSignOut();
  }, [onSignOut]);

  // Stable renderItem — avoids re-creating the function on every profileData change
  // by reading profileData from state (closure captures latest via re-render).
  const renderItem = useCallback(({ item }) => (
    <ProfileEventCard event={item} profileData={profileData} />
  ), [profileData]);

  const keyExtractor = useCallback((item) => item.id.toString(), []);

  function ItemSeparator() { return <View style={styles.divider} />; }

  // The profile header, sign-out button, and top divider live in ListHeaderComponent
  // so they scroll together with the feed inside the single FlatList.
  const ListHeader = useCallback(() => (
    <>
      <ProfileHeader
        profileData={profileData}
        onAvatarPress={handlePickAvatar}
        onFollowingPress={() => openList('following')}
        onFollowersPress={() => openList('followers')}
      />
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
      <View style={styles.divider} />
    </>
  ), [profileData, handlePickAvatar, handleSignOut, openList]);

  function FeedEmpty() {
    if (feedLoading) {
      return <ActivityIndicator color="#ffa028" style={{ marginTop: 32 }} />;
    }
    if (feedError) {
      return <Text style={styles.feedError}>{feedError}</Text>;
    }
    return <Text style={styles.feedEmpty}>your parties live here — post one or rsvp to your first</Text>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <FlatList
        data={feed}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ItemSeparatorComponent={ItemSeparator}
        ListEmptyComponent={FeedEmpty}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      />
      <FollowListSheet
        visible={listSheet !== null}
        type={listSheet}
        data={listData}
        loading={listLoading}
        onClose={closeList}
        onUserPress={(id) => setViewingUserId(id)}
      />
      <UserProfileSheet
        userId={viewingUserId}
        onClose={() => setViewingUserId(null)}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// Follow list bottom sheet
// ============================================================================
function FollowListSheet({ visible, type, data, loading, onClose, onUserPress }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={sheetStyles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={sheetStyles.sheet}>
        <View style={sheetStyles.handle} />
        <View style={sheetStyles.header}>
          <Text style={sheetStyles.title}>
            {type === 'followers' ? 'Followers' : 'Following'}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={sheetStyles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator color="#ffa028" style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={sheetStyles.userRow}
                onPress={() => onUserPress(item.id)}
                activeOpacity={0.7}
              >
                {item.profile_picture ? (
                  <Image source={{ uri: item.profile_picture }} style={sheetStyles.avatar} />
                ) : (
                  <View style={[sheetStyles.avatar, sheetStyles.avatarPlaceholder]}>
                    <Text style={sheetStyles.avatarInitial}>
                      {item.username?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                )}
                <View>
                  <Text style={sheetStyles.username}>@{item.username}</Text>
                  <Text style={sheetStyles.meta}>{item.followers_count ?? 0} followers</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={sheetStyles.empty}>no one here yet</Text>
            }
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
}

// ============================================================================
// Styles
// ============================================================================
const COLORS = {
  bg: '#000',
  text: '#fff',
  textMuted: '#8e8e93',
  divider: '#1c1c1e',
  badgeGoing: '#2c2c2e',
  badgeHosting: '#fff',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 20,
  },
  avatarWrap: { marginBottom: 0 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#333',
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#2b1d0a',
    borderWidth: 2,
    borderColor: '#ffa028',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#ffa028', fontSize: 28, fontWeight: '700' },
  avatarEdit: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffa028',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditText: { color: '#1a0d00', fontSize: 14, fontWeight: '700', lineHeight: 18 },
  headerInfo: {
    flex: 1,
    marginLeft: 14,
  },
  name: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  bio: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 4,
  },
  statText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  statNumber: {
    color: COLORS.text,
    fontWeight: '700',
  },

  // Sign out
  signOutBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  signOutText: { color: '#ef4444', fontWeight: '600' },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginVertical: 12,
  },

  // Empty / error state
  feedEmpty: {
    color: '#444',
    textAlign: 'center',
    marginTop: 32,
  },
  feedError: {
    color: '#e05050',
    textAlign: 'center',
    marginTop: 32,
    paddingHorizontal: 24,
  },

  // Event card
  eventCard: { paddingHorizontal: 16 },
  hostRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  hostInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  hostAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
    marginRight: 10,
  },
  hostAvatarPlaceholder: {
    backgroundColor: '#2b1d0a',
    borderWidth: 1,
    borderColor: '#ffa028',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostAvatarInitial: { color: '#ffa028', fontSize: 13, fontWeight: '700' },
  hostName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },

  // Status badges
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  badgeHosting: { backgroundColor: COLORS.badgeHosting },
  badgeGoing: { backgroundColor: COLORS.badgeGoing },
  badgeText: { fontSize: 13, fontWeight: '600' },
  badgeTextHosting: { color: '#000' },
  badgeTextGoing: { color: COLORS.text },

  // Event image + details
  eventImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 12,
    backgroundColor: '#222',
  },
  eventImagePlaceholder: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventImagePlaceholderText: {
    color: '#555',
    fontSize: 40,
    fontWeight: '700',
  },
  eventDetails: { paddingTop: 12 },
  eventTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  eventLocation: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginBottom: 10,
  },
  statePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statePillText: { fontSize: 12, fontWeight: '600' },
});

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  handle: {
    width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#444',
    alignSelf: 'center',
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  closeBtn: { color: '#666', fontSize: 18 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1c1c1e',
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#333',
  },
  avatarPlaceholder: {
    backgroundColor: '#2b1d0a',
    borderWidth: 1,
    borderColor: '#ffa028',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#ffa028', fontSize: 16, fontWeight: '700' },
  username: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#666', fontSize: 12, marginTop: 2 },
  empty: { color: '#444', textAlign: 'center', marginTop: 32 },
});
