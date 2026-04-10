import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, TextInput, StyleSheet, Dimensions,
  ScrollView, Text, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';

import { events, users } from '../api';
import EventCard from './EventCard';

const { height: SCREEN_H } = Dimensions.get('window');

const HEADER_H = 110;
const SPRING_V = { damping: 50, stiffness: 180, mass: 1.2 };
const SPRING_H = { damping: 40, stiffness: 200, mass: 1 };

export default function SearchSheet({ slideX, screenW, viewport }) {
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

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
  const debounceRef           = useRef(null);

  // load personalized feed on mount and whenever viewport settles
  const loadFeed = useCallback(async () => {
    setLoading(true);
    setMode('events');
    try {
      const data = await events.feed({ limit: 20 });
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [viewport]);

  // debounced search whenever query changes
  useEffect(() => {
    clearTimeout(debounceRef.current);

    if (!query.trim()) {
      loadFeed();
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
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
          const params = { hashtags: query.trim(), limit: 20 };
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
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function handleRsvp(eventId, status) {
    try { await events.rsvp(eventId, status); } catch {}
  }

  // ── vertical pan — handle + search bar only ────────────────────────────────
  const panV = Gesture.Pan()
    .onBegin(() => { startY.value = sheetY.value; })
    .onUpdate((e) => {
      const next = startY.value + e.translationY;
      sheetY.value = Math.max(SNAP_FULL, Math.min(SNAP_BAR, next));
    })
    .onEnd((e) => {
      const projected = sheetY.value + e.velocityY * 0.18;
      const closest = SNAPS_V.reduce((a, b) =>
        Math.abs(a - projected) < Math.abs(b - projected) ? a : b
      );
      sheetY.value = withSpring(closest, SPRING_V);
    });

  // ── horizontal pan — bottom zone (swipe left/right between screens) ────────
  const panH = Gesture.Pan()
    .failOffsetY([-15, 15])
    .onBegin(() => { startX.value = slideX.value; })
    .onUpdate((e) => {
      // clamp to one page in either direction from where the gesture started
      const lo = Math.max(-screenW * 2, startX.value - screenW);
      const hi = Math.min(0, startX.value + screenW);
      const next = startX.value + e.translationX;
      slideX.value = Math.max(lo, Math.min(hi, next));
    })
    .onEnd((e) => {
      const pages = [0, -screenW, -screenW * 2];
      const projected = slideX.value + e.velocityX * 0.18;
      const closest = pages.reduce((a, b) =>
        Math.abs(a - projected) < Math.abs(b - projected) ? a : b
      );
      slideX.value = withSpring(closest, SPRING_H);
    });

  const sheetStyle = useAnimatedStyle(() => ({ top: sheetY.value }));

  return (
    <Animated.View style={[styles.sheet, sheetStyle]}>

      {/* TOP ZONE — drag up/down only */}
      <GestureDetector gesture={panV}>
        <View style={styles.topZone}>
          <View style={styles.handle} />
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="search nearby… or @username"
              placeholderTextColor="#555"
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>
      </GestureDetector>

      {/* BOTTOM ZONE — swipe left/right + scrollable results */}
      <GestureDetector gesture={panH}>
        <View style={styles.bottomZone}>
          {loading ? (
            <ActivityIndicator color="#a855f7" style={styles.spinner} />
          ) : results.length === 0 ? (
            <Text style={styles.empty}>
              {query.startsWith('@') ? 'no users found' : 'no events nearby'}
            </Text>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {mode === 'users'
                ? results.map((u) => (
                    <View key={u.id} style={styles.userCard}>
                      <Text style={styles.userName}>@{u.username}</Text>
                      {u.bio ? <Text style={styles.userBio} numberOfLines={1}>{u.bio}</Text> : null}
                      <Text style={styles.userMeta}>{u.followers_count ?? 0} followers</Text>
                    </View>
                  ))
                : results.map((ev) => (
                    <EventCard key={ev.id} event={ev} onRsvp={handleRsvp} />
                  ))
              }
            </ScrollView>
          )}
        </View>
      </GestureDetector>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0, right: 0,
    height: SCREEN_H * 1.2,
    backgroundColor: '#111',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    flexDirection: 'column',
  },
  topZone: {},
  handle: {
    width: 40, height: 5, backgroundColor: '#555',
    borderRadius: 3, alignSelf: 'center', marginVertical: 14,
  },
  searchRow: { marginHorizontal: 16, marginBottom: 12 },
  searchInput: {
    height: 44, backgroundColor: '#1e1e1e',
    borderRadius: 12, paddingHorizontal: 16,
    color: '#fff', fontSize: 15,
  },
  bottomZone: { flex: 1 },
  spinner: { marginTop: 32 },
  empty: { color: '#444', textAlign: 'center', marginTop: 40, fontSize: 15 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  userCard: {
    backgroundColor: '#1a1a1a', borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  userName: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  userBio: { color: '#888', fontSize: 13, marginBottom: 4 },
  userMeta: { color: '#555', fontSize: 12 },
});
