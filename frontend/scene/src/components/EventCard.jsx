import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function EventCard({ event, onRsvp }) {
  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const goingCount = parseInt(event.going_count ?? 0);
  const isFull = event.capacity != null && goingCount >= event.capacity;
  const spotsLeft = event.capacity != null ? event.capacity - goingCount : null;
  const userStatus = event.user_rsvp ?? null;
  const isGoing = userStatus === 'going';
  const isInterested = userStatus === 'interested';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{event.title}</Text>
        {event.hashtags?.length > 0 && (
          <Text style={styles.cardTag}>#{event.hashtags[0]}</Text>
        )}
      </View>
      <Text style={styles.cardMeta}>{date}{event.address ? ` · ${event.address}` : ''}</Text>
      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.cardCount}>{goingCount} going</Text>
          {isFull
            ? <Text style={styles.capacityFull}>Full</Text>
            : spotsLeft != null && spotsLeft <= 5
              ? <Text style={styles.capacityLow}>{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</Text>
              : null
          }
        </View>
        <View style={styles.rsvpBtns}>
          <TouchableOpacity
            style={[styles.rsvpBtn, isGoing && styles.rsvpBtnActive, isFull && !isGoing && styles.rsvpBtnDisabled]}
            onPress={() => (!isFull || isGoing) && onRsvp(event.id, 'going')}
            disabled={isFull && !isGoing}
          >
            <Text style={[styles.rsvpBtnText, isFull && !isGoing && styles.rsvpBtnTextDisabled]}>
              {isGoing ? '✓ Going' : 'Going'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rsvpBtn, styles.rsvpBtnInterested, isInterested && styles.rsvpBtnInterestedActive]}
            onPress={() => onRsvp(event.id, 'interested')}
          >
            <Text style={[styles.rsvpBtnText, styles.rsvpBtnTextInterested]}>
              {isInterested ? '✓ Interested' : 'Interested'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  cardTag: { color: '#a855f7', fontSize: 12 },
  cardMeta: { color: '#555', fontSize: 13, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardCount: { color: '#666', fontSize: 13 },
  rsvpBtns: { flexDirection: 'row', gap: 8 },
  rsvpBtn: {
    backgroundColor: '#a855f7', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  rsvpBtnInterested: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#a855f7' },
  rsvpBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rsvpBtnTextInterested: { color: '#a855f7' },
  rsvpBtnActive: { backgroundColor: '#7c3aed' },
  rsvpBtnInterestedActive: { backgroundColor: '#2d1b4e', borderColor: '#7c3aed' },
  rsvpBtnDisabled: { backgroundColor: '#333' },
  rsvpBtnTextDisabled: { color: '#666' },
  capacityFull: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 2 },
  capacityLow: { color: '#f97316', fontSize: 12, fontWeight: '600', marginTop: 2 },
});
