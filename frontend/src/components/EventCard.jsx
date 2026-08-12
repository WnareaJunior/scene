import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { COLORS } from '../constants/colors';

// `onRsvp` is optional: the read-only web feed omits it and the RSVP button
// disappears (writes are out of scope on web v1). `showHost` adds the host's
// @username — the web feed has no map context to identify whose party it is.
export default function EventCard({ event, onRsvp, onPress, showHost = false, testID }) {
  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  const goingCount = Number(event.going_count ?? 0);
  const isFull = event.capacity != null && goingCount >= event.capacity;
  const spotsLeft = event.capacity != null ? event.capacity - goingCount : null;
  const userStatus = event.user_rsvp ?? null;
  const hasRsvp = userStatus !== null;

  // A second tap on an RSVP'd button is destructive (drops you off the list),
  // so it never fires bare — the constructive tap stays one-touch.
  const handleRsvpPress = () => {
    if (isFull && !hasRsvp) return;
    if (hasRsvp) {
      Alert.alert('leave the list?', "you'll drop off going for this party.", [
        { text: 'stay', style: 'cancel' },
        { text: 'leave', style: 'destructive', onPress: () => onRsvp(event.id, 'going') },
      ]);
    } else {
      onRsvp(event.id, 'going');
    }
  };

  const inner = (
    <>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{event.title}</Text>
        {event.hashtags?.length > 0 && (
          <Text style={styles.cardTag}>#{event.hashtags[0]}</Text>
        )}
      </View>
      {showHost && event.host_username ? (
        <Text style={styles.cardHost} testID="feed-post-host">@{event.host_username}</Text>
      ) : null}
      <Text style={styles.cardMeta}>{date}{event.address ? ` · ${event.address}` : ''}</Text>
      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.cardCount}>{goingCount} going</Text>
          {isFull
            ? <Text style={styles.capacityFull}>full</Text>
            : spotsLeft != null && spotsLeft <= 5
              ? <Text style={styles.capacityLow}>{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</Text>
              : null
          }
        </View>
        {onRsvp ? (
        <TouchableOpacity
          style={[styles.rsvpBtn, hasRsvp && styles.rsvpBtnActive, isFull && !hasRsvp && styles.rsvpBtnDisabled]}
          onPress={handleRsvpPress}
          disabled={isFull && !hasRsvp}
          accessibilityRole="button"
          accessibilityLabel={hasRsvp ? `you're going to ${event.title}, tap to leave` : `rsvp to ${event.title}`}
        >
          <Text style={[styles.rsvpBtnText, hasRsvp && styles.rsvpBtnTextActive, isFull && !hasRsvp && styles.rsvpBtnTextDisabled]}>
            {hasRsvp ? 'going ✓' : 'RSVP'}
          </Text>
        </TouchableOpacity>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        activeOpacity={0.85}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${date}`}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.card} testID={testID}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '600', flex: 1 },
  cardTag: { color: COLORS.accent, fontSize: 12 },
  cardHost: { color: COLORS.inkSecondary, fontSize: 13, marginBottom: 2 },
  cardMeta: { color: COLORS.inkSecondary, fontSize: 13, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardCount: { color: COLORS.inkSecondary, fontSize: 13 },
  // RSVP'd is a state, not a pressed shade: tint fill + accent border reads as
  // "held", distinct from both the resting fill and the finger-down darken.
  rsvpBtn: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 18, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  rsvpBtnText: { color: COLORS.accentInk, fontSize: 13, fontWeight: '600' },
  rsvpBtnActive: {
    backgroundColor: COLORS.accentTint,
    borderWidth: 1, borderColor: COLORS.accent,
  },
  rsvpBtnTextActive: { color: COLORS.accent },
  rsvpBtnDisabled: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: COLORS.border,
  },
  rsvpBtnTextDisabled: { color: COLORS.inkFaint },
  capacityFull: { color: COLORS.errorRed, fontSize: 12, fontWeight: '600', marginTop: 2 },
  capacityLow: { color: COLORS.accent, fontSize: 12, fontWeight: '600', marginTop: 2 },
});
