import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator, Platform,
  KeyboardAvoidingView, Dimensions,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { map, events, users, auth } from './src/api';
import { clearTokens } from './src/api';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const SNAP_PEEK = SCREEN_H * 0.75;
const SNAP_HALF = SCREEN_H * 0.45;
const SNAP_FULL = SCREEN_H * 0.12;

const CATEGORIES = ['all', 'music', 'art', 'food', 'sports', 'tech', 'social', 'diy', 'punk'];

export default function Scene({ user, onSignOut }) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);

  // Navigation
  const [screen, setScreen] = useState('map'); // 'map' | 'profile' | 'create'

  // Map state
  const [pins, setPins] = useState([]);
  const [viewport, setViewport] = useState(null);

  // Bottom sheet
  const sheetY = useSharedValue(SNAP_PEEK);
  const [sheetEvents, setSheetEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Profile state
  const [profileData, setProfileData] = useState(user);

  // Create event state
  const [createForm, setCreateForm] = useState({
    title: '', address: '', startTime: '', capacity: '', hashtag: '',
  });
  const [creating, setCreating] = useState(false);

  // ── Map pins ─────────────────────────────────────────────────────────────────

  const loadPins = useCallback(async (region) => {
    if (!region) return;
    const latD = region.latitudeDelta / 2;
    const lngD = region.longitudeDelta / 2;
    try {
      const data = await map.eventPins({
        swLat: region.latitude - latD,
        swLng: region.longitude - lngD,
        neLat: region.latitude + latD,
        neLng: region.longitude + lngD,
      });
      if (Array.isArray(data)) setPins(data);
    } catch {}
  }, []);

  // ── Sheet events ──────────────────────────────────────────────────────────────

  const loadSheetEvents = useCallback(async (region, category) => {
    if (!region) return;
    setLoadingEvents(true);
    const latD = region.latitudeDelta / 2;
    const lngD = region.longitudeDelta / 2;
    const params = {
      swLat: region.latitude - latD,
      swLng: region.longitude - lngD,
      neLat: region.latitude + latD,
      neLng: region.longitude + lngD,
      limit: 30,
    };
    if (category && category !== 'all') params.hashtags = category;
    try {
      const data = await events.discover(params);
      if (Array.isArray(data)) setSheetEvents(data);
    } catch {}
    setLoadingEvents(false);
  }, []);

  useEffect(() => {
    if (viewport) loadSheetEvents(viewport, activeCategory);
  }, [activeCategory, viewport]);

  // ── Bottom sheet gesture ──────────────────────────────────────────────────────

  const sheetGesture = Gesture.Pan()
    .activeOffsetY([-5, 5])
    .failOffsetX([-10, 10])
    .onUpdate((e) => {
      const next = sheetY.value + e.changeY;
      sheetY.value = Math.max(SNAP_FULL, Math.min(SNAP_PEEK, next));
    })
    .onEnd((e) => {
      const snaps = [SNAP_FULL, SNAP_HALF, SNAP_PEEK];
      const closest = snaps.reduce((a, b) =>
        Math.abs(a - sheetY.value) < Math.abs(b - sheetY.value) ? a : b
      );
      sheetY.value = withSpring(closest, { damping: 20 });
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  // ── Swipe navigation gesture ──────────────────────────────────────────────────

  const navGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .onEnd((e) => {
      const THRESHOLD = 60;
      if (e.translationX > THRESHOLD) {
        runOnJS(setScreen)('profile');
      } else if (e.translationX < -THRESHOLD) {
        runOnJS(setScreen)('create');
      } else {
        runOnJS(setScreen)('map');
      }
    });

  // ── Profile ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (screen === 'profile') {
      users.me().then((d) => { if (d?.id) setProfileData(d); }).catch(() => {});
    }
  }, [screen]);

  async function handleSignOut() {
    await auth.logout();
    await clearTokens();
    onSignOut();
  }

  // ── Create event ──────────────────────────────────────────────────────────────

  async function submitCreate() {
    if (!createForm.title || !createForm.startTime) {
      Alert.alert('Missing fields', 'Title and start time are required.');
      return;
    }
    if (!viewport) {
      Alert.alert('Location needed', 'Pan the map to set event location.');
      return;
    }
    setCreating(true);
    try {
      const data = await events.create({
        title: createForm.title,
        address: createForm.address,
        startTime: createForm.startTime,
        latitude: viewport.latitude,
        longitude: viewport.longitude,
        capacity: createForm.capacity ? parseInt(createForm.capacity) : undefined,
        hashtags: createForm.hashtag ? [createForm.hashtag] : [],
      });
      if (data?.id) {
        Alert.alert('Created!', `"${data.title}" is live.`);
        setCreateForm({ title: '', address: '', startTime: '', capacity: '', hashtag: '' });
        setScreen('map');
      } else {
        Alert.alert('Error', data?.error || 'Could not create event.');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setCreating(false);
  }

  // ── RSVP ─────────────────────────────────────────────────────────────────────

  async function handleRsvp(eventId, status) {
    try {
      await events.rsvp(eventId, status);
      if (viewport) loadSheetEvents(viewport, activeCategory);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const containerStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ translateX: withSpring(
      screen === 'profile' ? SCREEN_W : screen === 'create' ? -SCREEN_W : 0,
      { damping: 20 }
    )}],
  }));

  return (
    <View style={styles.root}>
      {/* Nav hints live outside the sliding view so they stay visible during swipe nav */}
      <SafeAreaView style={styles.navHints} pointerEvents="none">
        <Text style={styles.navHint}>👤</Text>
        <Text style={styles.appTitle}>scene</Text>
        <Text style={styles.navHint}>＋</Text>
      </SafeAreaView>

      <Animated.View style={[StyleSheet.absoluteFill, containerStyle]}>
        {/* ── MAP SCREEN ─────────────────────────── */}
        <GestureDetector gesture={navGesture}>
          <View style={StyleSheet.absoluteFill}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              customMapStyle={darkMapStyle}
              initialRegion={{
                latitude: 40.7128, longitude: -74.006,
                latitudeDelta: 0.05, longitudeDelta: 0.05,
              }}
              onRegionChangeComplete={(region) => {
                setViewport(region);
                loadPins(region);
              }}
              showsUserLocation
              showsMyLocationButton={false}
            >
              {pins.map((pin) => (
                <Marker
                  key={pin.id}
                  coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                  onPress={() => setSelectedEvent(pin)}
                >
                  <View style={styles.pin}>
                    <Text style={styles.pinText}>●</Text>
                  </View>
                </Marker>
              ))}
            </MapView>

            {/* Bottom sheet — gesture only on the drag handle, so ScrollViews scroll freely */}
            <Animated.View style={[styles.sheet, sheetStyle]}>
              <GestureDetector gesture={sheetGesture}>
                <View style={styles.sheetHandleArea}>
                  <View style={styles.sheetHandle} />
                </View>
              </GestureDetector>

              {/* Categories */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categories}
                contentContainerStyle={styles.categoriesContent}
              >
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPill, activeCategory === cat && styles.catPillActive]}
                    onPress={() => setActiveCategory(cat)}
                  >
                    <Text style={[styles.catText, activeCategory === cat && styles.catTextActive]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Event list */}
              <ScrollView style={styles.eventList} showsVerticalScrollIndicator={false}>
                {loadingEvents ? (
                  <ActivityIndicator color="#a855f7" style={{ marginTop: 24 }} />
                ) : sheetEvents.length === 0 ? (
                  <Text style={styles.empty}>No events in this area</Text>
                ) : (
                  sheetEvents.map((ev) => (
                    <EventCard key={ev.id} event={ev} onRsvp={handleRsvp} />
                  ))
                )}
              </ScrollView>
            </Animated.View>
          </View>
        </GestureDetector>

        {/* ── PROFILE SCREEN ─────────────────────── */}
        <View style={[styles.sideScreen, { left: -SCREEN_W }]}>
          <SafeAreaView style={styles.safeContent}>
            <Text style={styles.screenTitle}>profile</Text>
            <View style={styles.profileCard}>
              <Text style={styles.profileName}>{profileData?.username}</Text>
              <Text style={styles.profileEmail}>{profileData?.email}</Text>
              {profileData?.bio ? <Text style={styles.profileBio}>{profileData.bio}</Text> : null}
              <View style={styles.profileStats}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{profileData?.followers_count ?? 0}</Text>
                  <Text style={styles.statLabel}>followers</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{profileData?.following_count ?? 0}</Text>
                  <Text style={styles.statLabel}>following</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        {/* ── CREATE SCREEN ──────────────────────── */}
        <KeyboardAvoidingView
          style={[styles.sideScreen, { left: SCREEN_W }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.safeContent}>
            <Text style={styles.screenTitle}>create event</Text>
            <Text style={styles.createHint}>Location: map center</Text>

            <TextInput style={styles.input} placeholder="title" placeholderTextColor="#555"
              value={createForm.title} onChangeText={(v) => setCreateForm(f => ({ ...f, title: v }))} />
            <TextInput style={styles.input} placeholder="address (display only)" placeholderTextColor="#555"
              value={createForm.address} onChangeText={(v) => setCreateForm(f => ({ ...f, address: v }))} />
            <TextInput style={styles.input} placeholder="start time (ISO 8601: 2024-06-01T20:00:00Z)" placeholderTextColor="#555"
              value={createForm.startTime} onChangeText={(v) => setCreateForm(f => ({ ...f, startTime: v }))} />
            <TextInput style={styles.input} placeholder="capacity (optional)" placeholderTextColor="#555"
              keyboardType="number-pad"
              value={createForm.capacity} onChangeText={(v) => setCreateForm(f => ({ ...f, capacity: v }))} />
            <TextInput style={styles.input} placeholder="category tag (e.g. music)" placeholderTextColor="#555"
              autoCapitalize="none"
              value={createForm.hashtag} onChangeText={(v) => setCreateForm(f => ({ ...f, hashtag: v }))} />

            <TouchableOpacity style={styles.createBtn} onPress={submitCreate} disabled={creating}>
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Post event</Text>}
            </TouchableOpacity>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

function EventCard({ event, onRsvp }) {
  const date = event.start_time
    ? new Date(event.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
          <TouchableOpacity style={[styles.rsvpBtn, styles.rsvpBtnInterested]} onPress={() => onRsvp(event.id, 'interested')}>
            <Text style={[styles.rsvpBtnText, styles.rsvpBtnTextInterested]}>Interested</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', overflow: 'hidden' },
  navHints: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  navHint: { color: 'rgba(255,255,255,0.5)', fontSize: 20 },
  appTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  sheet: {
    position: 'absolute', left: 0, right: 0,
    height: SCREEN_H,
    backgroundColor: '#111',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  sheetHandleArea: {
    paddingVertical: 12, alignItems: 'center',
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: '#333',
    borderRadius: 2,
  },
  categories: { maxHeight: 44 },
  categoriesContent: { paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
  catPill: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#1e1e1e',
  },
  catPillActive: { backgroundColor: '#a855f7' },
  catText: { color: '#888', fontSize: 13 },
  catTextActive: { color: '#fff', fontWeight: '600' },
  eventList: { flex: 1, paddingHorizontal: 16, marginTop: 8 },
  empty: { color: '#444', textAlign: 'center', marginTop: 40, fontSize: 15 },
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
  pin: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#a855f7', alignItems: 'center', justifyContent: 'center',
  },
  pinText: { color: '#fff', fontSize: 8 },
  sideScreen: {
    position: 'absolute', top: 0, bottom: 0, width: SCREEN_W,
    backgroundColor: '#0a0a0a',
  },
  safeContent: { flex: 1, paddingHorizontal: 24 },
  screenTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20, marginTop: 16 },
  profileCard: {
    backgroundColor: '#1a1a1a', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#2a2a2a',
  },
  profileName: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  profileEmail: { color: '#666', fontSize: 14, marginBottom: 10 },
  profileBio: { color: '#aaa', fontSize: 15, marginBottom: 16 },
  profileStats: { flexDirection: 'row', gap: 24 },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statLabel: { color: '#555', fontSize: 12 },
  signOutBtn: {
    marginTop: 20, backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  signOutText: { color: '#ef4444', fontWeight: '600' },
  createHint: { color: '#555', fontSize: 13, marginBottom: 16, marginTop: -8 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10,
    padding: 13, fontSize: 15, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  createBtn: {
    backgroundColor: '#a855f7', borderRadius: 10,
    padding: 15, alignItems: 'center', marginTop: 8,
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#444' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
