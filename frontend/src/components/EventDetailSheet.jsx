import React from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity,
  ScrollView, StyleSheet, Platform,
} from 'react-native';

const STATE_COLORS = { live: '#22c55e', upcoming: '#a855f7', past: '#555' };

function getState(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time ? new Date(event.end_time).getTime() : null;
  if (end && now >= start && now <= end) return 'live';
  if (now < start) return 'upcoming';
  return 'past';
}

export default function EventDetailSheet({ event, onClose, onRsvp, onHostPress }) {
  if (!event) return null;

  const goingCount = Number(event.going_count ?? 0);
  const isFull = event.capacity != null && goingCount >= event.capacity;
  const spotsLeft = event.capacity != null ? event.capacity - goingCount : null;
  const hasRsvp = event.user_rsvp != null;
  const state = getState(event);

  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <Modal
      visible={event !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Close */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        {/* Scrollable content */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Hero image */}
          {event.image_url ? (
            <Image source={{ uri: event.image_url }} style={styles.hero} />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Text style={styles.heroPlaceholderText}>{event.title?.[0] ?? '?'}</Text>
            </View>
          )}

          {/* Host row — tappable */}
          <TouchableOpacity
            style={styles.hostRow}
            onPress={() => onHostPress(event.host_id)}
            activeOpacity={0.7}
          >
            {event.host_picture ? (
              <Image source={{ uri: event.host_picture }} style={styles.hostAvatar} />
            ) : (
              <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
                <Text style={styles.hostAvatarInitial}>
                  {event.host_username?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
            <View>
              <Text style={styles.hostLabel}>hosted by</Text>
              <Text style={styles.hostName}>@{event.host_username}</Text>
            </View>
          </TouchableOpacity>

          {/* Title */}
          <Text style={styles.title}>{event.title}</Text>

          {/* State pill */}
          <View style={[styles.statePill, { borderColor: STATE_COLORS[state] }]}>
            <Text style={[styles.statePillText, { color: STATE_COLORS[state] }]}>
              {state.charAt(0).toUpperCase() + state.slice(1)}
            </Text>
          </View>

          {/* Date + address */}
          <Text style={styles.meta}>{date}</Text>
          {event.address ? <Text style={styles.meta}>{event.address}</Text> : null}

          {/* Description */}
          {event.description ? (
            <Text style={styles.description}>{event.description}</Text>
          ) : null}

          {/* Hashtags */}
          {event.hashtags?.length > 0 && (
            <View style={styles.tagsRow}>
              {event.hashtags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Capacity */}
          <View style={styles.capacityRow}>
            <Text style={styles.goingText}>{goingCount} going</Text>
            {isFull
              ? <Text style={styles.full}>Full</Text>
              : spotsLeft != null && spotsLeft <= 10
                ? <Text style={styles.low}>{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</Text>
                : null
            }
          </View>
        </ScrollView>

        {/* Sticky RSVP button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.rsvpBtn,
              hasRsvp && styles.rsvpBtnActive,
              isFull && !hasRsvp && styles.rsvpBtnDisabled,
            ]}
            onPress={() => (!isFull || hasRsvp) && onRsvp(event.id, 'going')}
            disabled={isFull && !hasRsvp}
            activeOpacity={0.8}
          >
            <Text style={[styles.rsvpBtnText, isFull && !hasRsvp && styles.rsvpBtnTextDisabled]}>
              {isFull && !hasRsvp ? 'Event Full' : hasRsvp ? "RSVP'd ✓" : 'RSVP'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 5, borderRadius: 3, backgroundColor: '#333',
    alignSelf: 'center', marginVertical: 12,
  },
  closeBtn: { position: 'absolute', top: 14, right: 16 },
  closeBtnText: { color: '#555', fontSize: 18 },

  scroll: { flex: 0 },
  scrollContent: { paddingBottom: 8 },

  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#111' },
  heroPlaceholder: {
    width: '100%', aspectRatio: 16 / 9,
    backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center',
  },
  heroPlaceholderText: { color: '#333', fontSize: 64, fontWeight: '700' },

  hostRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
  },
  hostAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#333' },
  hostAvatarPlaceholder: {
    backgroundColor: '#2a1a3e', borderWidth: 1, borderColor: '#a855f7',
    alignItems: 'center', justifyContent: 'center',
  },
  hostAvatarInitial: { color: '#a855f7', fontSize: 14, fontWeight: '700' },
  hostLabel: { color: '#555', fontSize: 11 },
  hostName: { color: '#a855f7', fontSize: 14, fontWeight: '600' },

  title: {
    color: '#fff', fontSize: 22, fontWeight: '800',
    paddingHorizontal: 16, marginBottom: 8,
  },
  statePill: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    marginHorizontal: 16, marginBottom: 10,
  },
  statePillText: { fontSize: 12, fontWeight: '600' },
  meta: { color: '#666', fontSize: 14, paddingHorizontal: 16, marginBottom: 4 },
  description: {
    color: '#aaa', fontSize: 14, lineHeight: 21,
    paddingHorizontal: 16, marginTop: 12, marginBottom: 4,
  },
  tagsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, marginTop: 12,
  },
  tag: {
    backgroundColor: '#1a1a2e', borderRadius: 20,
    paddingVertical: 4, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#a855f7',
  },
  tagText: { color: '#a855f7', fontSize: 12, fontWeight: '600' },
  capacityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, marginTop: 14, marginBottom: 4,
  },
  goingText: { color: '#555', fontSize: 13 },
  full: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  low: { color: '#f97316', fontSize: 12, fontWeight: '600' },

  footer: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1c1c1e',
  },
  rsvpBtn: {
    backgroundColor: '#a855f7', borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  rsvpBtnActive: { backgroundColor: '#7c3aed' },
  rsvpBtnDisabled: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  rsvpBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rsvpBtnTextDisabled: { color: '#444' },
});
