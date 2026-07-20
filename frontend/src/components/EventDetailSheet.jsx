import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity,
  ScrollView, StyleSheet, Platform, ActivityIndicator,
  Animated, PanResponder, Alert, Share,
} from 'react-native';
import { events as eventsApi } from '../api';
import { COLORS } from '../constants/colors';

const STATE_COLORS = { live: COLORS.liveGreen, upcoming: COLORS.amber, past: COLORS.inkFaint };

// Parties without an explicit end are treated as live for 4 hours after they
// start — otherwise "live" is unreachable and everything jumps straight to past.
const DEFAULT_DURATION_MS = 4 * 3600000;

function getState(event) {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time
    ? new Date(event.end_time).getTime()
    : start + DEFAULT_DURATION_MS;
  if (now >= start && now <= end) return 'live';
  if (now < start) return 'upcoming';
  return 'past';
}

// A "thin" event is a list/pin item missing the host fields the sheet renders.
// Discover rows include host_picture (possibly null); feed rows and map pins omit
// it entirely (undefined) and have no host_id. Detect that so we can refetch.
function isThin(event) {
  return event != null && (event.host_id == null || event.host_picture === undefined);
}

export default function EventDetailSheet({ event: eventProp, onClose, onRsvp, onHostPress, currentUserId, onDeleted }) {
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Swipe-down to dismiss: follow the finger when a downward drag starts while
  // the content is scrolled to the top, then close past the threshold.
  const translateY = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panResponder = useRef(
    PanResponder.create({
      // Capture phase so the drag wins over the ScrollView when it's at the top.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        scrollOffsetRef.current <= 0 && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 800, duration: 180, useNativeDriver: true })
            .start(() => {
              translateY.setValue(0);
              onCloseRef.current();
            });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  // Self-heal: when opened with a thin item, refetch the full event by id so the
  // host row, description, and counts render instead of "@undefined".
  useEffect(() => {
    let cancelled = false;
    if (eventProp && isThin(eventProp)) {
      setFull(null);
      setLoading(true);
      eventsApi.get(eventProp.id)
        .then((data) => { if (!cancelled) setFull(data); })
        .catch(() => { /* fall back to the thin item below */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setFull(null);
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [eventProp?.id]);

  if (!eventProp) return null;

  const event = full || eventProp;
  const showLoading = loading && !full;

  const goingCount = Number(event.going_count ?? 0);
  const isFull = event.capacity != null && goingCount >= event.capacity;
  const spotsLeft = event.capacity != null ? event.capacity - goingCount : null;
  const hasRsvp = event.user_rsvp != null;
  const state = getState(event);
  const isHost = currentUserId != null && event.host_id === currentUserId;

  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  const handleRsvpPress = () => {
    if (isFull && !hasRsvp) return;
    if (hasRsvp) {
      // Second tap is destructive — never a bare toggle.
      Alert.alert('leave the list?', "you'll drop off going for this party.", [
        { text: 'stay', style: 'cancel' },
        { text: 'leave', style: 'destructive', onPress: () => onRsvp(event.id, 'going') },
      ]);
    } else {
      onRsvp(event.id, 'going');
    }
  };

  const handleShare = () => {
    Share.share({
      message: `${event.title} — ${date}${event.address ? ` · ${event.address}` : ''} (on scene)`,
    }).catch(() => {});
  };

  const handleReport = () => {
    const send = (reason) => {
      eventsApi.report(event.id, reason).catch(() => {});
      Alert.alert('got it', "thanks — we'll take a look.");
    };
    Alert.alert('report this party?', "tell us what's wrong.", [
      { text: 'nevermind', style: 'cancel' },
      { text: "it's spam or fake", onPress: () => send('spam or fake') },
      { text: "it's offensive or unsafe", onPress: () => send('offensive or unsafe') },
    ]);
  };

  const handleTakeDown = () => {
    Alert.alert('take it down?', 'the party comes off the map for everyone. no undo.', [
      { text: 'keep it up', style: 'cancel' },
      {
        text: 'take it down',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await eventsApi.cancel(event.id);
            onDeleted?.(event.id);
            onCloseRef.current();
          } catch {
            Alert.alert("couldn't take it down", 'check your connection and try again.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Close */}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="close party details"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        {showLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={COLORS.amber} />
          </View>
        ) : (
          <>
            {/* Scrollable content */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              {/* Hero image */}
              {event.image_url ? (
                <Image
                  source={{ uri: event.image_url }}
                  style={styles.hero}
                  accessibilityLabel={`${event.title} flyer`}
                />
              ) : (
                <View style={styles.heroPlaceholder}>
                  <Text style={styles.heroPlaceholderText}>{event.title?.[0] ?? '?'}</Text>
                </View>
              )}

              {/* Title first — "what party is this" beats "who's hosting it" */}
              <View style={styles.titleRow}>
                <Text style={styles.title}>{event.title}</Text>
                <View style={[styles.statePill, { borderColor: STATE_COLORS[state] }]}>
                  <Text style={[styles.statePillText, { color: STATE_COLORS[state] }]}>
                    {state}
                  </Text>
                </View>
              </View>

              {/* Date + address */}
              <Text style={styles.meta}>{date}</Text>
              {event.address ? <Text style={styles.meta}>{event.address}</Text> : null}

              {/* Host row — tappable (guarded against a missing host id) */}
              <TouchableOpacity
                style={styles.hostRow}
                onPress={() => event.host_id != null && onHostPress(event.host_id)}
                disabled={event.host_id == null}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`hosted by ${event.host_username ?? 'unknown'}, view profile`}
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
                  <Text style={styles.hostName}>@{event.host_username ?? '…'}</Text>
                </View>
              </TouchableOpacity>

              {/* Description */}
              {event.description ? (
                <Text style={styles.description}>{event.description}</Text>
              ) : null}

              {/* Hashtags — quiet; the streetlight belongs to the RSVP button */}
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
                  ? <Text style={styles.full}>full</Text>
                  : spotsLeft != null && spotsLeft <= 10
                    ? <Text style={styles.low}>{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</Text>
                    : null
                }
              </View>

              {/* Host controls / guest report */}
              {isHost ? (
                <TouchableOpacity
                  style={styles.takeDownBtn}
                  onPress={handleTakeDown}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="take this party down"
                >
                  <Text style={styles.takeDownText}>{deleting ? 'taking it down…' : 'take it down'}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.reportBtn}
                  onPress={handleReport}
                  accessibilityRole="button"
                  accessibilityLabel="report this party"
                >
                  <Text style={styles.reportText}>report this party</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Sticky footer — RSVP + share */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.rsvpBtn,
                  hasRsvp && styles.rsvpBtnActive,
                  isFull && !hasRsvp && styles.rsvpBtnDisabled,
                ]}
                onPress={handleRsvpPress}
                disabled={isFull && !hasRsvp}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={hasRsvp ? "you're going, tap to leave" : 'rsvp to this party'}
              >
                <Text style={[styles.rsvpBtnText, hasRsvp && styles.rsvpBtnTextActive, isFull && !hasRsvp && styles.rsvpBtnTextDisabled]}>
                  {isFull && !hasRsvp ? 'party full' : hasRsvp ? 'going ✓' : 'RSVP'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel="share this party"
              >
                <Text style={styles.shareBtnText}>send it</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.scrim },
  sheet: {
    backgroundColor: COLORS.asphalt,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  handle: {
    width: 40, height: 5, borderRadius: 3, backgroundColor: COLORS.handle,
    alignSelf: 'center', marginVertical: 12,
  },
  closeBtn: {
    position: 'absolute', top: 12, right: 14, zIndex: 10,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: COLORS.ink, fontSize: 16 },

  loadingBox: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 0 },
  scrollContent: { paddingBottom: 8 },

  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: COLORS.surface },
  heroPlaceholder: {
    width: '100%', aspectRatio: 16 / 9,
    backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center',
  },
  heroPlaceholderText: { color: COLORS.handle, fontSize: 64, fontWeight: '700' },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 16, marginBottom: 8,
  },
  title: { color: COLORS.ink, fontSize: 22, fontWeight: '800', flexShrink: 1 },
  statePill: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  statePillText: { fontSize: 12, fontWeight: '600' },
  meta: { color: COLORS.inkSecondary, fontSize: 14, paddingHorizontal: 16, marginBottom: 4 },

  hostRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  hostAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.card },
  hostAvatarPlaceholder: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  hostAvatarInitial: { color: COLORS.inkSecondary, fontSize: 14, fontWeight: '700' },
  hostLabel: { color: COLORS.inkSecondary, fontSize: 11 },
  hostName: { color: COLORS.ink, fontSize: 14, fontWeight: '600' },

  description: {
    color: COLORS.ink, fontSize: 14, lineHeight: 21,
    paddingHorizontal: 16, marginTop: 12, marginBottom: 4,
  },
  tagsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, marginTop: 12,
  },
  tag: {
    backgroundColor: COLORS.card, borderRadius: 20,
    paddingVertical: 4, paddingHorizontal: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tagText: { color: COLORS.inkSecondary, fontSize: 12, fontWeight: '600' },
  capacityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, marginTop: 14, marginBottom: 4,
  },
  goingText: { color: COLORS.inkSecondary, fontSize: 13 },
  full: { color: COLORS.errorRed, fontSize: 12, fontWeight: '600' },
  low: { color: COLORS.amber, fontSize: 12, fontWeight: '600' },

  takeDownBtn: {
    marginHorizontal: 16, marginTop: 16, minHeight: 44,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center',
  },
  takeDownText: { color: COLORS.errorRed, fontSize: 14, fontWeight: '600' },
  reportBtn: {
    marginTop: 12, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  reportText: { color: COLORS.inkSecondary, fontSize: 13, fontWeight: '600' },

  footer: {
    flexDirection: 'row', gap: 10, alignItems: 'stretch',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  rsvpBtn: {
    flex: 1, backgroundColor: COLORS.amber, borderRadius: 12,
    minHeight: 50, alignItems: 'center', justifyContent: 'center',
  },
  rsvpBtnActive: {
    backgroundColor: COLORS.amberTint,
    borderWidth: 1, borderColor: COLORS.amber,
  },
  rsvpBtnDisabled: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  rsvpBtnText: { color: COLORS.amberInk, fontSize: 16, fontWeight: '700' },
  rsvpBtnTextActive: { color: COLORS.amber },
  rsvpBtnTextDisabled: { color: COLORS.inkFaint },
  shareBtn: {
    minHeight: 50, paddingHorizontal: 18,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtnText: { color: COLORS.ink, fontSize: 15, fontWeight: '600' },
});
