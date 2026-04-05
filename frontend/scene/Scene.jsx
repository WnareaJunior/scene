/**
 * Scene - Base UI Shell
 * React Native component
 *
 * Layout:
 *   - Center: Map view
 *   - Bottom: Apple Maps-style draggable sheet
 *   - Swipe RIGHT → Profile screen
 *   - Swipe LEFT  → Event Creation screen
 *
 * Dependencies:
 *   npx expo install react-native-gesture-handler react-native-reanimated
 *                    react-native-safe-area-context react-native-maps
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolate,
  runOnJS,
  clamp,
} from 'react-native-reanimated';
import MapView from 'react-native-maps';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Constants ───────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = SCREEN_W * 0.28;
const SHEET_PEEK      = 110;
const SHEET_HALF      = SCREEN_H * 0.45;
const SHEET_FULL      = SCREEN_H * 0.88;
const SHEET_RANGE     = SHEET_FULL - SHEET_PEEK;
const SPRING          = { damping: 22, stiffness: 180 };

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  bg:         '#0D0D0F',
  surface:    '#18181C',
  surfaceAlt: '#222228',
  border:     '#2A2A32',
  accent:     '#6C63FF',
  accentSoft: '#6C63FF22',
  text:       '#F0F0F5',
  textMuted:  '#7A7A8C',
  pill:       '#28282F',
  white:      '#FFFFFF',
  danger:     '#FF4B6E',
  success:    '#3DD68C',
};

// ─── Static data ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: '1', emoji: '🎶', label: 'Music' },
  { id: '2', emoji: '🍕', label: 'Food' },
  { id: '3', emoji: '🏀', label: 'Sports' },
  { id: '4', emoji: '🎨', label: 'Art' },
  { id: '5', emoji: '🎤', label: 'Comedy' },
];

const NEARBY_EVENTS = [
  { id: 'e1', title: 'Rooftop Jazz Night',        location: 'Williamsburg, BK', time: 'Fri 9 PM',  tag: 'Music'  },
  { id: 'e2', title: 'Street Food Festival',       location: 'LES, Manhattan',   time: 'Sat 12 PM', tag: 'Food'   },
  { id: 'e3', title: 'Pickup Basketball 3v3',      location: 'Prospect Park',    time: 'Sun 10 AM', tag: 'Sports' },
  { id: 'e4', title: 'Figure Drawing Open Studio', location: 'Bushwick, BK',     time: 'Sat 7 PM',  tag: 'Art'    },
];

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function ProfileScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sideScreen, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.sideTitle}>Profile</Text>
      <View style={styles.avatarRing}>
        <View style={styles.avatarInner}>
          <Text style={{ fontSize: 36 }}>👤</Text>
        </View>
      </View>
      <Text style={styles.profileName}>Wilson M.</Text>
      <Text style={styles.profileSub}>Brooklyn, NY · 0 events hosted</Text>

      <View style={styles.statsRow}>
        {[['Following', '12'], ['Followers', '8'], ['Events', '0']].map(([label, val]) => (
          <View key={label} style={styles.statBox}>
            <Text style={styles.statVal}>{val}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {[
        { icon: '⚙️', label: 'Settings' },
        { icon: '🔔', label: 'Notifications' },
        { icon: '🎫', label: 'My Tickets' },
        { icon: '❤️', label: 'Saved Events' },
      ].map(({ icon, label }) => (
        <TouchableOpacity key={label} style={styles.profileRow} activeOpacity={0.7}>
          <Text style={{ fontSize: 18 }}>{icon}</Text>
          <Text style={styles.profileRowLabel}>{label}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT CREATION SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function EventCreationScreen() {
  const insets = useSafeAreaInsets();
  const [title, setTitle]       = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate]         = useState('');
  const [category, setCategory] = useState(null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.sideScreen, { paddingTop: insets.top + 16 }]}
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sideTitle}>New Event</Text>
        <Text style={styles.sideSubtitle}>Drop a pin, share the moment.</Text>

        <Text style={styles.fieldLabel}>TITLE</Text>
        <TextInput
          style={styles.fieldInput}
          placeholder="What's happening?"
          placeholderTextColor={C.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.fieldLabel}>LOCATION</Text>
        <TextInput
          style={styles.fieldInput}
          placeholder="Search or pin on map"
          placeholderTextColor={C.textMuted}
          value={location}
          onChangeText={setLocation}
        />

        <Text style={styles.fieldLabel}>DATE & TIME</Text>
        <TextInput
          style={styles.fieldInput}
          placeholder="Pick a date"
          placeholderTextColor={C.textMuted}
          value={date}
          onChangeText={setDate}
        />

        <Text style={styles.fieldLabel}>CATEGORY</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map(({ id, emoji, label }) => (
            <TouchableOpacity
              key={id}
              style={[styles.categoryChip, category === id && styles.categoryChipActive]}
              onPress={() => setCategory(id)}
              activeOpacity={0.7}
            >
              <Text>{emoji}</Text>
              <Text style={[styles.categoryChipText, category === id && { color: C.white }]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.createBtn} activeOpacity={0.85}>
          <Text style={styles.createBtnText}>Create Event</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOTTOM SHEET
// ─────────────────────────────────────────────────────────────────────────────
function BottomSheet({ translateY, onSearchFocus }) {
  const insets = useSafeAreaInsets();

  const panGesture = Gesture.Pan()
    .onChange((e) => {
      translateY.value = clamp(translateY.value + e.changeY, -SHEET_RANGE, 0);
    })
    .onEnd((e) => {
      const current = Math.abs(translateY.value);
      if (e.velocityY < -500 || current > SHEET_RANGE * 0.6) {
        translateY.value = withSpring(-SHEET_RANGE, SPRING);
      } else if (current > SHEET_RANGE * 0.2) {
        translateY.value = withSpring(-(SHEET_HALF - SHEET_PEEK), SPRING);
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [-(SHEET_HALF - SHEET_PEEK), 0],
      [0.3, 1],
      Extrapolate.CLAMP
    ),
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.sheet, sheetStyle, { paddingBottom: insets.bottom }]}>

        <Animated.View style={[styles.handleWrap, handleOpacity]}>
          <View style={styles.handle} />
        </Animated.View>

        <TouchableOpacity style={styles.searchBar} activeOpacity={0.85} onPress={onSearchFocus}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search events, places..."
            placeholderTextColor={C.textMuted}
            onFocus={onSearchFocus}
          />
          <View style={styles.searchFilter}>
            <Text style={{ fontSize: 16 }}>⚡</Text>
          </View>
        </TouchableOpacity>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillScroll}
        >
          {CATEGORIES.map(({ id, emoji, label }) => (
            <TouchableOpacity key={id} style={styles.pill} activeOpacity={0.7}>
              <Text>{emoji}</Text>
              <Text style={styles.pillText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>NEARBY EVENTS</Text>
          {NEARBY_EVENTS.map((ev) => (
            <TouchableOpacity key={ev.id} style={styles.eventCard} activeOpacity={0.8}>
              <View style={styles.eventCardLeft}>
                <Text style={styles.eventCardTitle}>{ev.title}</Text>
                <Text style={styles.eventCardMeta}>{ev.location}  ·  {ev.time}</Text>
              </View>
              <View style={[styles.eventTag, { backgroundColor: C.accentSoft }]}>
                <Text style={[styles.eventTagText, { color: C.accent }]}>{ev.tag}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

      </Animated.View>
    </GestureDetector>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function Scene() {
  const [activeScreen, setActiveScreen] = useState(1); // 0=profile 1=map 2=create
  const swipeX = useSharedValue(0);
  const sheetY = useSharedValue(0);

  const goTo = useCallback((idx) => setActiveScreen(idx), []);

  const snapSheetFull = useCallback(() => {
    sheetY.value = withSpring(-SHEET_RANGE, SPRING);
  }, []);

  const horizontalGesture = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onChange((e) => {
      if (Math.abs(sheetY.value) < 40) {
        swipeX.value += e.changeX;
      }
    })
    .onEnd((e) => {
      if (e.translationX < -SWIPE_THRESHOLD) {
        swipeX.value = withSpring(0, SPRING);
        runOnJS(goTo)(2);
      } else if (e.translationX > SWIPE_THRESHOLD) {
        swipeX.value = withSpring(0, SPRING);
        runOnJS(goTo)(0);
      } else {
        swipeX.value = withSpring(0, SPRING);
        runOnJS(goTo)(1);
      }
    });

  const mapContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
  }));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />

      {activeScreen === 0 && (
        <View style={StyleSheet.absoluteFill}>
          <ProfileScreen />
        </View>
      )}
      {activeScreen === 2 && (
        <View style={StyleSheet.absoluteFill}>
          <EventCreationScreen />
        </View>
      )}

      <GestureDetector gesture={horizontalGesture}>
        <Animated.View style={[StyleSheet.absoluteFill, mapContainerStyle]}>

          <MapView
            style={StyleSheet.absoluteFill}
            customMapStyle={DARK_MAP_STYLE}
            showsUserLocation
            showsCompass={false}
            initialRegion={{
              latitude:       40.6782,
              longitude:     -73.9442,
              latitudeDelta:  0.08,
              longitudeDelta: 0.08,
            }}
          />

          <SafeAreaView style={styles.hud} pointerEvents="box-none">
            <View style={styles.hudRow}>
              <TouchableOpacity style={styles.hudBtn} onPress={() => setActiveScreen(0)} activeOpacity={0.8}>
                <Text style={{ fontSize: 18 }}>👤</Text>
              </TouchableOpacity>
              <View style={styles.hudLogo}>
                <Text style={styles.hudLogoText}>Scene</Text>
              </View>
              <TouchableOpacity style={styles.hudBtn} onPress={() => setActiveScreen(2)} activeOpacity={0.8}>
                <Text style={{ fontSize: 20 }}>＋</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.swipeHintRow} pointerEvents="none">
              <Text style={styles.swipeHint}>← Profile</Text>
              <Text style={styles.swipeHint}>Create Event →</Text>
            </View>
          </SafeAreaView>

          <View style={styles.sheetAnchor} pointerEvents="box-none">
            <BottomSheet translateY={sheetY} onSearchFocus={snapSheetFull} />
          </View>

        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  hud: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  hudRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8,
  },
  hudBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  hudLogo: {
    paddingHorizontal: 18, paddingVertical: 8,
    backgroundColor: C.surface + 'EE',
    borderRadius: 24, borderWidth: 1, borderColor: C.border,
  },
  hudLogoText: {
    color: C.accent, fontSize: 17, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif-medium',
  },
  swipeHintRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: 8,
  },
  swipeHint: { color: C.textMuted, fontSize: 11, opacity: 0.7 },

  sheetAnchor: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: SHEET_FULL, justifyContent: 'flex-end',
  },
  sheet: {
    height: SHEET_FULL, backgroundColor: C.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: C.border,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: C.text, fontSize: 15, padding: 0 },
  searchFilter: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  pillScroll: { paddingHorizontal: 16, paddingBottom: 12, gap: 8, flexDirection: 'row' },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.pill, borderRadius: 24,
    paddingHorizontal: 14, paddingVertical: 8,
    gap: 6, borderWidth: 1, borderColor: C.border,
  },
  pillText: { color: C.text, fontSize: 13, fontWeight: '500' },

  sectionLabel: {
    color: C.textMuted, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, marginBottom: 12, marginTop: 4,
  },
  eventCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surfaceAlt, borderRadius: 16,
    padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  eventCardLeft: { flex: 1 },
  eventCardTitle: { color: C.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  eventCardMeta:  { color: C.textMuted, fontSize: 13 },
  eventTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  eventTagText: { fontSize: 12, fontWeight: '600' },

  sideScreen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 24 },
  sideTitle:  { color: C.text, fontSize: 28, fontWeight: '700', marginBottom: 4 },
  sideSubtitle: { color: C.textMuted, fontSize: 15, marginBottom: 28 },

  avatarRing: {
    alignSelf: 'center', width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 16, marginBottom: 12,
  },
  avatarInner: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  profileName: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  profileSub:  { color: C.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: C.surfaceAlt, borderRadius: 20,
    padding: 20, marginBottom: 24, borderWidth: 1, borderColor: C.border,
  },
  statBox:   { alignItems: 'center' },
  statVal:   { color: C.text, fontSize: 22, fontWeight: '700' },
  statLabel: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  profileRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border, gap: 14,
  },
  profileRowLabel: { flex: 1, color: C.text, fontSize: 16 },
  chevron: { color: C.textMuted, fontSize: 22 },

  fieldLabel: {
    color: C.textMuted, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.2, marginBottom: 8, marginTop: 20,
  },
  fieldInput: {
    backgroundColor: C.surfaceAlt, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  categoryChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  categoryChipText: { color: C.textMuted, fontSize: 13, fontWeight: '500' },
  createBtn: {
    marginTop: 32, backgroundColor: C.accent,
    borderRadius: 18, paddingVertical: 18, alignItems: 'center',
  },
  createBtnText: { color: C.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});

// ─────────────────────────────────────────────────────────────────────────────
//  DARK MAP STYLE
// ─────────────────────────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: 'geometry',            stylers: [{ color: '#0D0D0F' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#746855' }] },
  { elementType: 'labels.text.stroke',  stylers: [{ color: '#242f3e' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi',             elementType: 'labels.text.fill',  stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park',        elementType: 'geometry',           stylers: [{ color: '#1a1f2e' }] },
  { featureType: 'poi.park',        elementType: 'labels.text.fill',  stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road',            elementType: 'geometry',           stylers: [{ color: '#2c313a' }] },
  { featureType: 'road',            elementType: 'geometry.stroke',    stylers: [{ color: '#212a37' }] },
  { featureType: 'road',            elementType: 'labels.text.fill',  stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway',    elementType: 'geometry',           stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway',    elementType: 'geometry.stroke',    stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway',    elementType: 'labels.text.fill',  stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit',         elementType: 'geometry',           stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill',  stylers: [{ color: '#d59563' }] },
  { featureType: 'water',           elementType: 'geometry',           stylers: [{ color: '#0D1B2A' }] },
  { featureType: 'water',           elementType: 'labels.text.fill',  stylers: [{ color: '#515c6d' }] },
  { featureType: 'water',           elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];