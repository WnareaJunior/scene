import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function EventCard({ event, onRsvp }) {
  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

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
        <Text style={styles.cardCount}>{event.going_count ?? 0} going</Text>
        <View style={styles.rsvpBtns}>
          <TouchableOpacity style={styles.rsvpBtn} onPress={() => onRsvp(event.id, 'going')}>
            <Text style={styles.rsvpBtnText}>Going</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rsvpBtn, styles.rsvpBtnInterested]}
            onPress={() => onRsvp(event.id, 'interested')}
          >
            <Text style={[styles.rsvpBtnText, styles.rsvpBtnTextInterested]}>Interested</Text>
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
});
