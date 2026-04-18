import React from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';

// ============================================================================
// Mock data — replace with props / API data
// ============================================================================
const MOCK_USER = {
  id: 'u1',
  name: 'Alex Chen',
  bio: 'Event enthusiast | NYC | Always up for coffee meetups',
  avatar: 'https://i.pravatar.cc/150?img=12',
  following: 324,
  followers: 1200,
};

const MOCK_EVENTS = [
  {
    id: 'e1',
    title: 'Brooklyn Rooftop Gathering',
    location: 'Williamsburg, Brooklyn',
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800',
    attendingCount: 24,
    commentCount: 8,
    host: {
      id: 'u2',
      name: 'Sarah Martinez',
      avatar: 'https://i.pravatar.cc/150?img=45',
    },
    status: 'hosting', // 'hosting' | 'going' | null
    topComment: { author: 'Mike', text: "Can't wait for this!" },
  },
  {
    id: 'e2',
    title: 'Coffee & Code Meetup',
    location: 'Manhattan, NYC',
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
    attendingCount: 0,
    commentCount: 0,
    host: {
      id: 'u3',
      name: 'David Kim',
      avatar: 'https://i.pravatar.cc/150?img=13',
    },
    status: 'going',
    topComment: null,
  },
];

// ============================================================================
// Formatters
// ============================================================================
const formatCount = (n) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

// ============================================================================
// Subcomponents
// ============================================================================
const ProfileHeader = ({ user, onFollowingPress, onFollowersPress, onAvatarPress }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.8}>
      <Image source={{ uri: user.avatar }} style={styles.avatar} />
    </TouchableOpacity>
    <View style={styles.headerInfo}>
      <Text style={styles.name}>{user.name}</Text>
      <Text style={styles.bio}>{user.bio}</Text>
      <View style={styles.statsRow}>
        <TouchableOpacity onPress={onFollowingPress} activeOpacity={0.7}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(user.following)}</Text> Following
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onFollowersPress} activeOpacity={0.7}>
          <Text style={styles.statText}>
            <Text style={styles.statNumber}>{formatCount(user.followers)}</Text> Followers
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

const EventCard = ({ event, onPress, onHostPress, onCommentsPress }) => (
  <View style={styles.eventCard}>
    {/* Host row */}
    <View style={styles.hostRow}>
      <TouchableOpacity
        style={styles.hostInfo}
        onPress={() => onHostPress(event.host)}
        activeOpacity={0.7}
      >
        <Image source={{ uri: event.host.avatar }} style={styles.hostAvatar} />
        <Text style={styles.hostName}>{event.host.name}</Text>
      </TouchableOpacity>
      <StatusBadge status={event.status} />
    </View>

    {/* Event image + details (tappable) */}
    <TouchableOpacity onPress={() => onPress(event)} activeOpacity={0.9}>
      <Image source={{ uri: event.image }} style={styles.eventImage} />
      <View style={styles.eventDetails}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventLocation}>{event.location}</Text>

        {(event.attendingCount > 0 || event.commentCount > 0) && (
          <View style={styles.metricsRow}>
            {event.attendingCount > 0 && (
              <View style={styles.metric}>
                <Text style={styles.metricIcon}>✓</Text>
                <Text style={styles.metricText}>{event.attendingCount}</Text>
              </View>
            )}
            {event.commentCount > 0 && (
              <TouchableOpacity
                style={styles.metric}
                onPress={() => onCommentsPress(event)}
                activeOpacity={0.7}
              >
                <Text style={styles.metricIcon}>💬</Text>
                <Text style={styles.metricText}>{event.commentCount}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {event.topComment && (
          <Text style={styles.commentText} numberOfLines={1}>
            <Text style={styles.commentAuthor}>{event.topComment.author}</Text>{' '}
            {event.topComment.text}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  </View>
);

// ============================================================================
// Main screen
// ============================================================================
export default function ProfileScreen({ user = MOCK_USER, events = MOCK_EVENTS }) {
  const handleAvatarPress = () => console.log('Avatar pressed:', user.id);
  const handleFollowingPress = () => console.log('Following pressed');
  const handleFollowersPress = () => console.log('Followers pressed');
  const handleEventPress = (event) => console.log('Event pressed:', event.id, event.title);
  const handleHostPress = (host) => console.log('Host pressed:', host.id, host.name);
  const handleCommentsPress = (event) => console.log('Comments pressed:', event.id);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHeader
          user={user}
          onAvatarPress={handleAvatarPress}
          onFollowingPress={handleFollowingPress}
          onFollowersPress={handleFollowersPress}
        />
        <View style={styles.divider} />

        {events.map((event, idx) => (
          <React.Fragment key={event.id}>
            <EventCard
              event={event}
              onPress={handleEventPress}
              onHostPress={handleHostPress}
              onCommentsPress={handleCommentsPress}
            />
            {idx < events.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </ScrollView>
    </SafeAreaView>
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
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  header: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#333',
  },
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

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginVertical: 12,
  },

  // Event card
  eventCard: {
    paddingHorizontal: 16,
  },
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
  badgeHosting: {
    backgroundColor: COLORS.badgeHosting,
  },
  badgeGoing: {
    backgroundColor: COLORS.badgeGoing,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badgeTextHosting: {
    color: '#000',
  },
  badgeTextGoing: {
    color: COLORS.text,
  },

  // Event image + details
  eventImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 12,
    backgroundColor: '#222',
  },
  eventDetails: {
    paddingTop: 12,
  },
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
  metricsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 8,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricIcon: {
    color: COLORS.text,
    fontSize: 14,
  },
  metricText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '500',
  },
  commentText: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  commentAuthor: {
    color: COLORS.text,
    fontWeight: '700',
  },
});