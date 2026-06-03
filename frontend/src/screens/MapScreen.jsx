import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { map as mapApi, events } from '../api';
import { haversineKm } from '../utils/geo';
import { darkMapStyle } from '../constants/mapStyles';
import EventDetailSheet from '../components/EventDetailSheet';
import UserProfileSheet from '../components/UserProfileSheet';

const initialRegion = {
  latitude: 40.7128, longitude: -74.006,
  latitudeDelta: 0.05, longitudeDelta: 0.05,
};

// Significant zoom change: delta ratio differs by more than 30%.
function zoomChanged(prev, next) {
  if (!prev) return true;
  const ratio = next.latitudeDelta / prev.latitudeDelta;
  return ratio > 1.3 || ratio < 0.77;
}

function regionToBounds(region) {
  const latD = region.latitudeDelta / 2;
  const lngD = region.longitudeDelta / 2;
  return {
    swLat: region.latitude - latD,
    swLng: region.longitude - lngD,
    neLat: region.latitude + latD,
    neLng: region.longitude + lngD,
  };
}

// Debounce delay in ms — matches SearchSheet's viewport debounce.
const DEBOUNCE_MS = 400;
// Minimum map-center movement (km) required to trigger a new pin fetch.
const MIN_MOVE_KM = 0.5;

export default function MapScreen({ onRegionChangeComplete }) {
  const [pins, setPins] = useState([]);
  const [fetchError, setFetchError] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  const mapRef = useRef(null);
  // Refs for debounce and movement guard — never trigger re-renders.
  const debounceRef = useRef(null);
  const lastFetchRef = useRef(null); // { lat, lng, region }

  const fetchPins = useCallback(async (region) => {
    try {
      const data = await mapApi.eventPins(regionToBounds(region));
      setPins(Array.isArray(data) ? data : []);
      setFetchError(false);
    } catch {
      setFetchError(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const region = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          };
          mapRef.current?.animateToRegion(region, 0);
          fetchPins(region);
          return;
        }
      } catch {}
      fetchPins(initialRegion);
    })();
  }, [fetchPins]);

  const handleRegionChange = useCallback((region) => {
    // Always notify the parent of the latest viewport (used by SearchSheet).
    onRegionChangeComplete(region);

    // Debounce + distance guard: cancel any pending fetch and start a new timer.
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const last = lastFetchRef.current;

      if (last) {
        const moved = haversineKm(last.lat, last.lng, region.latitude, region.longitude);
        const zoomed = zoomChanged(last.region, region);
        // Skip the fetch if the user only panned a tiny distance without zooming.
        if (moved < MIN_MOVE_KM && !zoomed) return;
      }

      lastFetchRef.current = { lat: region.latitude, lng: region.longitude, region };
      fetchPins(region);
    }, DEBOUNCE_MS);
  }, [onRegionChangeComplete, fetchPins]);

  // Tap a pin → fetch the full event (pins carry only id/lat/lng/title) and open
  // the detail sheet.
  async function openEvent(pin) {
    try {
      const fullEvent = await events.get(pin.id);
      setSelectedEvent(fullEvent);
    } catch {
      Alert.alert('Unavailable', 'Could not load this event. Please try again.');
    }
  }

  // Optimistic RSVP for the open event, with rollback on failure.
  async function handleRsvp(eventId, status) {
    const current = selectedEvent;
    if (!current || current.id !== eventId) return;

    const prevStatus = current.user_rsvp ?? null;
    const newStatus = prevStatus === status ? null : status;
    let delta = 0;
    if (prevStatus === 'going' && newStatus !== 'going') delta = -1;
    else if (prevStatus !== 'going' && newStatus === 'going') delta = 1;

    setSelectedEvent({
      ...current,
      user_rsvp: newStatus,
      going_count: Math.max(0, Number(current.going_count ?? 0) + delta),
    });

    try {
      if (newStatus === null) await events.cancelRsvp(eventId);
      else if (prevStatus !== null) await events.updateRsvp(eventId, newStatus);
      else await events.rsvp(eventId, newStatus);
    } catch {
      setSelectedEvent(current);
      Alert.alert('Error', 'Could not update RSVP. Please try again.');
    }
  }

  async function centerOnUser() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location access denied',
          'Enable location in Settings to center the map on your position.',
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 600);
    } catch {
      Alert.alert('Location unavailable', 'Could not determine your current location.');
    }
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        initialRegion={initialRegion}
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            title={pin.title}
            pinColor="#a855f7"
            onPress={() => openEvent(pin)}
          />
        ))}
      </MapView>

      <TouchableOpacity style={styles.locBtn} onPress={centerOnUser}>
        <Text style={styles.locBtnText}>⊙</Text>
      </TouchableOpacity>

      {fetchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Something went wrong</Text>
        </View>
      )}

      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onRsvp={handleRsvp}
        onHostPress={(hostId) => {
          setSelectedEvent(null);
          setViewingUserId(hostId);
        }}
      />

      <UserProfileSheet
        userId={viewingUserId}
        onClose={() => setViewingUserId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  locBtn: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(17,17,17,0.9)',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locBtnText: {
    color: '#a855f7',
    fontSize: 20,
    lineHeight: 24,
  },
  errorBanner: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(220,50,50,0.9)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  errorBannerText: {
    color: '#fff',
    fontSize: 14,
  },
});

