import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, TextInput, StyleSheet, Dimensions,
  FlatList, Text, TouchableOpacity, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS, ReduceMotion,
} from 'react-native-reanimated';

import { events, users } from '../api';
import { COLORS } from '../constants/colors';
import EventCard from './EventCard';
import EventDetailSheet from './EventDetailSheet';
import { haversineKm } from '../utils/geo';
import UserProfileSheet from './UserProfileSheet';

const { height: SCREEN_H } = Dimensions.get('window');

const HEADER_H = 110;
// Springs carry the release velocity (passed per-gesture); configs stay lively
// rather than overdamped so the settle glides instead of thudding.
// ReduceMotion.Never: these settle gesture positions; the system Reduce Motion
// default completes them in one frame, snapping releases instead of gliding.
const SPRING_V = { damping: 32, stiffness: 260, mass: 0.9, reduceMotion: ReduceMotion.Never };
const SPRING_H = { damping: 34, stiffness: 280, mass: 0.9, reduceMotion: ReduceMotion.Never };
// Drag resistance past the last snap point — rubber band, not a wall.
const OVERDRAG = 0.15;

// Feed widening: if the current map area surfaces fewer than MIN_FEED_RESULTS
// parties, progressively scan a larger radius (up to MAX_FEED_RADIUS_MILES)
// centered on the viewport until we reach the target or the ladder runs out.
const MIN_FEED_RESULTS = 10;
const MAX_FEED_RADIUS_MILES = 30;
const MILES_TO_KM = 1.60934;
// Radius ladder (miles); steps at or below the current viewport are skipped.
const WIDEN_LADDER_MILES = [5, 10, 20, MAX_FEED_RADIUS_MILES];

export default function SearchSheet({ slideX, screenW, viewport, onNavigate, currentUserId }) {
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  // Measured height of the handle + search header; seeds with the static sum
  // of those styles so the first layout pass is already close.
  const [topZoneH, setTopZoneH] = useState(89);

  const SNAP_FULL = safeTop + 16;
  const SNAP_HALF = SCREEN_H * 0.45;
  const SNAP_PEEK = SCREEN_H * 0.72;
  const SNAP_BAR  = SCREEN_H - HEADER_H - safeBottom;
  const SNAPS_V   = [SNAP_FULL, SNAP_HALF, SNAP_PEEK, SNAP_BAR];

  // ── gesture shared values ──────────────────────────────────────────────────
  const sheetY = useSharedValue(SNAP_BAR);
  const startY = useSharedValue(SNAP_BAR);
  const startX = useSharedValue(0);

  // ── search state ───────────────────────────────────────────────────────────
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [mode, setMode]       = useState('events'); // 'events' | 'users'
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const debounceRef           = useRef(null);
  const viewportTimerRef      = useRef(null);
  const feedGenRef            = useRef(0);
  const lastFetchPosRef       = useRef(null);

  // Keep a ref so loadFeed can always read the latest viewport without it
  // appearing in the dependency array (avoids recreating the callback on every pan).
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // load nearby public events — stable reference, reads viewport via ref
  const loadFeed = useCallback(async () => {
    const gen = ++feedGenRef.current;
    setLoading(true);
    setMode('events');
    setErrorMsg(null);
    try {
      const vp = viewportRef.current;
      const base = { limit: 20, startAfter: new Date().toISOString() };

      // No viewport yet (location unresolved) — plain chronological feed.
      if (!vp) {
        const data = await events.discover(base);
        if (gen !== feedGenRef.current) return; // stale — a newer fetch is in flight
        setResults(Array.isArray(data) ? data : []);
        return;
      }

      const latD = vp.latitudeDelta / 2;
      const lngD = vp.longitudeDelta / 2;
      const neLat = vp.latitude + latD;
      const neLng = vp.longitude + lngD;

      // 1) Rank parties within the current map area. Passing the center (lat/lng)
      //    alongside the bounding box makes the backend sort by relevance
      //    (proximity + start time) instead of chronologically.
      const data = await events.discover({
        ...base,
        swLat: vp.latitude - latD, swLng: vp.longitude - lngD,
        neLat, neLng,
        lat: vp.latitude, lng: vp.longitude,
      });
      if (gen !== feedGenRef.current) return; // stale — a newer fetch is in flight
      let list = Array.isArray(data) ? data : [];

      // 2) Sparse area — progressively widen the search radius (up to
      //    MAX_FEED_RADIUS_MILES) until at least MIN_FEED_RESULTS parties show
      //    up or the ladder is exhausted. Each step is a superset, ranked by
      //    relevance, so nearby parties still surface first.
      if (list.length < MIN_FEED_RESULTS) {
        const viewportRadiusMiles =
          haversineKm(vp.latitude, vp.longitude, neLat, neLng) / MILES_TO_KM;

        for (const miles of WIDEN_LADDER_MILES) {
          if (miles <= viewportRadiusMiles) continue; // already covered by the box
          const wide = await events.discover({
            ...base,
            lat: vp.latitude, lng: vp.longitude,
            radius: Math.round(miles * MILES_TO_KM * 1000), // meters
          });
          if (gen !== feedGenRef.current) return;
          const wideList = Array.isArray(wide) ? wide : [];
          if (wideList.length > list.length) list = wideList;
          if (list.length >= MIN_FEED_RESULTS) break;
        }
      }

      setResults(list);
    } catch {
      if (gen !== feedGenRef.current) return;
      setResults([]);
      setErrorMsg("couldn't load parties — pull down to retry");
    } finally {
      if (gen === feedGenRef.current) setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadFeed();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadFeed]);

  // Debounced viewport effect: wait 400 ms after panning stops, then skip the
  // fetch entirely if the map center moved less than 0.5 km since the last one.
  useEffect(() => {
    clearTimeout(viewportTimerRef.current);

    viewportTimerRef.current = setTimeout(() => {
      if (viewport && lastFetchPosRef.current) {
        const dist = haversineKm(
          lastFetchPosRef.current.lat,
          lastFetchPosRef.current.lng,
          viewport.latitude,
          viewport.longitude,
        );
        if (dist < 0.5) return;
      }
      if (viewport) {
        lastFetchPosRef.current = { lat: viewport.latitude, lng: viewport.longitude };
      }
      loadFeed();
    }, 400);

    return () => clearTimeout(viewportTimerRef.current);
  }, [viewport, loadFeed]);

  // debounced search whenever query changes
  useEffect(() => {
    clearTimeout(debounceRef.current);

    if (!query.trim()) {
      loadFeed();
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        if (query.startsWith('@')) {
          const username = query.slice(1).trim();
          setMode('users');
          if (username) {
            const data = await users.search(username);
            setResults(Array.isArray(data) ? data : []);
          } else {
            setResults([]);
          }
        } else {
          setMode('events');
          const params = { hashtags: query.trim(), limit: 20, startAfter: new Date().toISOString() };
          if (viewport) {
            const latD = viewport.latitudeDelta / 2;
            const lngD = viewport.longitudeDelta / 2;
            params.swLat = viewport.latitude - latD;
            params.swLng = viewport.longitude - lngD;
            params.neLat = viewport.latitude + latD;
            params.neLng = viewport.longitude + lngD;
          }
          const data = await events.discover(params);
          setResults(Array.isArray(data) ? data : []);
        }
      } catch {
        setResults([]);
        setErrorMsg("couldn't load parties — pull down to retry");
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [query, loadFeed]);

  async function handleRsvp(eventId, status) {
    const prevEvent = results.find(ev => ev.id === eventId);
    if (!prevEvent) return;

    const prevStatus = prevEvent.user_rsvp ?? null;
    const newStatus = prevStatus === status ? null : status;

    let countDelta = 0;
    if (prevStatus === 'going' && newStatus !== 'going') countDelta = -1;
    else if (prevStatus !== 'going' && newStatus === 'going') countDelta = 1;

    setResults(rs => rs.map(ev =>
      ev.id === eventId
        ? { ...ev, user_rsvp: newStatus, going_count: Math.max(0, parseInt(ev.going_count ?? 0) + countDelta) }
        : ev
    ));

    try {
      if (newStatus === null) {
        await events.cancelRsvp(eventId);
      } else if (prevStatus !== null) {
        await events.updateRsvp(eventId, newStatus);
      } else {
        await events.rsvp(eventId, newStatus);
      }
    } catch {
      setResults(rs => rs.map(ev => ev.id === eventId ? prevEvent : ev));
      Alert.alert("rsvp didn't save", 'check your connection and tap it again.');
    }
  }

  // ── vertical pan — handle + search bar only ────────────────────────────────
  const panV = Gesture.Pan()
    .onBegin(() => { startY.value = sheetY.value; })
    .onUpdate((e) => {
      const next = startY.value + e.translationY;
      const clamped = Math.max(SNAP_FULL, Math.min(SNAP_BAR, next));
      sheetY.value = clamped + (next - clamped) * OVERDRAG;
    })
    .onEnd((e) => {
      const projected = sheetY.value + e.velocityY * 0.18;
      const closest = SNAPS_V.reduce((a, b) =>
        Math.abs(a - projected) < Math.abs(b - projected) ? a : b
      );
      sheetY.value = withSpring(closest, { ...SPRING_V, velocity: e.velocityY });
    });

  // ── horizontal pan — bottom zone (swipe left/right between screens) ────────
  const panH = Gesture.Pan()
    .failOffsetY([-15, 15])
    .onBegin(() => { startX.value = slideX.value; })
    .onUpdate((e) => {
      // rubber-band past one page in either direction from where the gesture started
      const lo = Math.max(-screenW * 2, startX.value - screenW);
      const hi = Math.min(0, startX.value + screenW);
      const next = startX.value + e.translationX;
      const clamped = Math.max(lo, Math.min(hi, next));
      slideX.value = clamped + (next - clamped) * OVERDRAG;
    })
    .onEnd((e) => {
      const didSwipe = Math.abs(e.translationX) > screenW * 0.25 || Math.abs(e.velocityX) > 300;
      if (didSwipe) {
        const dir = e.translationX < 0 ? -1 : 1;
        const target = Math.max(-screenW * 2, Math.min(0, startX.value + dir * screenW));
        // Determine which named page the target corresponds to and delegate to parent.
        if (target === 0) runOnJS(onNavigate)('create', e.velocityX);
        else if (target === -screenW) runOnJS(onNavigate)('map', e.velocityX);
        else if (target === -screenW * 2) runOnJS(onNavigate)('profile', e.velocityX);
        else slideX.value = withSpring(target, { ...SPRING_H, velocity: e.velocityX });
      } else {
        slideX.value = withSpring(startX.value, { ...SPRING_H, velocity: e.velocityX });
      }
    });

  // translateY, not top: animating a layout prop forces a full relayout of the
  // sheet subtree every frame on Fabric, which drops the drag to end-state
  // snaps. Transforms stay on the UI thread and follow the finger.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  return (
    <Animated.View style={[styles.sheet, sheetStyle]}>

      {/* TOP ZONE — drag up/down only */}
      <GestureDetector gesture={panV}>
        <View
          style={styles.topZone}
          onLayout={(e) => setTopZoneH(Math.round(e.nativeEvent.layout.height))}
        >
          <View style={styles.handle} />
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="search tags… or @username"
              placeholderTextColor={COLORS.inkSecondary}
              accessibilityLabel="search parties by tag or people by username"
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>
      </GestureDetector>

      {/* BOTTOM ZONE — swipe left/right + scrollable results.
          The sheet itself is 1.2× screen height so overdrag never exposes the
          map beneath it; a flex:1 list would inherit that oversize and put its
          tail past the bottom of the screen, making the last cards unreachable.
          Size the scroll area to exactly what's visible at the full snap. */}
      <GestureDetector gesture={panH}>
        <View style={[styles.bottomZone, { height: SCREEN_H - SNAP_FULL - topZoneH }]}>
          {errorMsg && !loading && (
            <Text style={styles.errorText}>{errorMsg}</Text>
          )}
          {loading && !isRefreshing ? (
            <ActivityIndicator color="#ffa028" style={styles.spinner} />
          ) : errorMsg ? null : results.length === 0 ? (
            <Text style={styles.empty}>
              {query.startsWith('@') ? 'no one by that username' : 'nothing nearby yet — swipe right to post the first party'}
            </Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id.toString()}
              style={styles.list}
              contentContainerStyle={[styles.listContent, { paddingBottom: safeBottom + 24 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor="#ffa028"
                />
              }
              renderItem={({ item }) =>
                mode === 'users' ? (
                  <TouchableOpacity
                    style={styles.userCard}
                    onPress={() => setViewingUserId(item.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.userName}>@{item.username}</Text>
                    {item.bio ? <Text style={styles.userBio} numberOfLines={1}>{item.bio}</Text> : null}
                    <Text style={styles.userMeta}>{item.followers_count ?? 0} followers</Text>
                  </TouchableOpacity>
                ) : (
                  <EventCard
                    event={item}
                    onRsvp={handleRsvp}
                    onPress={() => setSelectedEvent(item)}
                  />
                )
              }
            />
          )}
        </View>
      </GestureDetector>

      <UserProfileSheet
        userId={viewingUserId}
        onClose={() => setViewingUserId(null)}
      />

      <EventDetailSheet
        event={selectedEvent}
        currentUserId={currentUserId}
        onDeleted={(id) => {
          setResults((rs) => rs.filter((ev) => ev.id !== id));
        }}
        onClose={() => setSelectedEvent(null)}
        onRsvp={(eventId, status) => {
          handleRsvp(eventId, status);
          setSelectedEvent((prev) =>
            prev?.id === eventId
              ? {
                  ...prev,
                  user_rsvp: prev.user_rsvp === status ? null : status,
                  going_count: Number(prev.going_count ?? 0) +
                    (prev.user_rsvp === status ? -1 : prev.user_rsvp != null ? 0 : 1),
                }
              : prev
          );
        }}
        onHostPress={(hostId) => {
          setSelectedEvent(null);
          setViewingUserId(hostId);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0, right: 0,
    height: SCREEN_H * 1.2,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    flexDirection: 'column',
  },
  topZone: {},
  handle: {
    width: 40, height: 5, backgroundColor: COLORS.handle,
    borderRadius: 3, alignSelf: 'center', marginVertical: 14,
  },
  searchRow: { marginHorizontal: 16, marginBottom: 12 },
  searchInput: {
    height: 44, backgroundColor: COLORS.card,
    borderRadius: 12, paddingHorizontal: 16,
    color: COLORS.ink, fontSize: 15,
  },
  bottomZone: {},
  spinner: { marginTop: 32 },
  empty: { color: COLORS.inkSecondary, textAlign: 'center', marginTop: 40, fontSize: 15 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
  userCard: {
    backgroundColor: COLORS.card, borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  userName: { color: COLORS.ink, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  userBio: { color: COLORS.inkSecondary, fontSize: 13, marginBottom: 4 },
  userMeta: { color: COLORS.inkSecondary, fontSize: 12 },
  errorText: { color: COLORS.errorRed, textAlign: 'center', marginTop: 20, fontSize: 14 },
});
