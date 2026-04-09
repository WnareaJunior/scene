import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';

import { map, events } from '../api';
import EventCard from '../components/EventCard';

const { height: SCREEN_H } = Dimensions.get('window');
const SNAP_PEEK = SCREEN_H * 0.75;
const SNAP_HALF = SCREEN_H * 0.45;
const SNAP_FULL = SCREEN_H * 0.12;

const CATEGORIES = ['all', 'music', 'art', 'food', 'sports', 'tech', 'social', 'diy', 'punk'];

export default function MapScreen({ navGesture, viewport, onViewportChange }) {
  const mapRef = useRef(null);

  const [pins, setPins] = useState([]);
  const [sheetEvents, setSheetEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const sheetY = useSharedValue(SNAP_PEEK);

  // ── Map pins ────────────────────────────────────────────────────────────────

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

  // ── Sheet events ─────────────────────────────────────────────────────────────

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

  // ── RSVP ─────────────────────────────────────────────────────────────────────

  async function handleRsvp(eventId, status) {
    try {
      await events.rsvp(eventId, status);
      if (viewport) loadSheetEvents(viewport, activeCategory);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  // ── Bottom sheet gesture ─────────────────────────────────────────────────────

  const sheetGesture = Gesture.Pan()
    .activeOffsetY([-5, 5])
    .failOffsetX([-10, 10])
    .onUpdate((e) => {
      const next = sheetY.value + e.changeY;
      sheetY.value = Math.max(SNAP_FULL, Math.min(SNAP_PEEK, next));
    })
    .onEnd(() => {
      const snaps = [SNAP_FULL, SNAP_HALF, SNAP_PEEK];
      const closest = snaps.reduce((a, b) =>
        Math.abs(a - sheetY.value) < Math.abs(b - sheetY.value) ? a : b
      );
      sheetY.value = withSpring(closest, { damping: 20 });
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
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
            onViewportChange(region);
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
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0,
    height: SCREEN_H,
    backgroundColor: '#111',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  sheetHandleArea: { paddingVertical: 12, alignItems: 'center' },
  sheetHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2 },
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
  pin: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#a855f7', alignItems: 'center', justifyContent: 'center',
  },
  pinText: { color: '#fff', fontSize: 8 },
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
