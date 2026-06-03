import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function EventCard({ event, onRsvp, onPress }) {
  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const goingCount = Number(event.going_count ?? 0);
  const isFull = event.capacity != null && goingCount >= event.capacity;
  const spotsLeft = event.capacity != null ? event.capacity - goingCount : null;
  const userStatus = event.user_rsvp ?? null;
  const hasRsvp = userStatus !== null;

  const inner = (
    <>
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
        <TouchableOpacity
          style={[styles.rsvpBtn, hasRsvp && styles.rsvpBtnActive, isFull && !hasRsvp && styles.rsvpBtnDisabled]}
          onPress={() => (!isFull || hasRsvp) && onRsvp(event.id, 'going')}
          disabled={isFull && !hasRsvp}
        >
          <Text style={[styles.rsvpBtnText, isFull && !hasRsvp && styles.rsvpBtnTextDisabled]}>
            {hasRsvp ? "RSVP'd" : 'RSVP'}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.card}>{inner}</View>;
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
  rsvpBtn: {
    backgroundColor: '#a855f7', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  rsvpBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rsvpBtnActive: { backgroundColor: '#7c3aed' },
  rsvpBtnDisabled: { backgroundColor: '#333' },
  rsvpBtnTextDisabled: { color: '#666' },
  capacityFull: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 2 },
  capacityLow: { color: '#f97316', fontSize: 12, fontWeight: '600', marginTop: 2 },
});
