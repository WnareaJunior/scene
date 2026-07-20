import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert, Share } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { map as mapApi, events } from '../api';
import { haversineKm } from '../utils/geo';
import { darkMapStyle } from '../constants/mapStyles';
import { COLORS } from '../constants/colors';
import EventDetailSheet from '../components/EventDetailSheet';
import UserProfileSheet from '../components/UserProfileSheet';

const initialRegion = {
  latitude: 40.7128, longitude: -74.006,
  latitudeDelta: 0.05, longitudeDelta: 0.05,
};

const DEFAULT_DURATION_MS = 4 * 3600000;

function pinIsLive(pin) {
  if (!pin.start_time) return false;
  const now = Date.now();
  const start = new Date(pin.start_time).getTime();
  const end = pin.end_time
    ? new Date(pin.end_time).getTime()
    : start + DEFAULT_DURATION_MS;
  return now >= start && now <= end;
}

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

// Chip-style marker: the label IS the marker. tracksViewChanges must be turned
// off after the chip has rendered (kept on briefly, incl. on title changes) or
// iOS re-rasterizes every marker each frame, which tanks map performance.
// A live party's chip burns green — the one place Live Green touches the map.
function EventMarker({ pin, onPress }) {
  const [tracksChanges, setTracksChanges] = useState(true);
  const live = pinIsLive(pin);

  useEffect(() => {
    setTracksChanges(true);
    const t = setTimeout(() => setTracksChanges(false), 500);
    return () => clearTimeout(t);
  }, [pin.title, live]);

  return (
    <Marker
      coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracksChanges}
      onPress={onPress}
    >
      <View style={styles.markerWrap}>
        <View style={[styles.markerChip, live && styles.markerChipLive]}>
          {live && <View style={styles.liveDot} />}
          <Text style={styles.markerText} numberOfLines={1}>{pin.title}</Text>
        </View>
        <View style={[styles.markerPointer, live && styles.markerPointerLive]} />
      </View>
    </Marker>
  );
}

// Debounce delay in ms — matches SearchSheet's viewport debounce.
const DEBOUNCE_MS = 400;
// Minimum map-center movement (km) required to trigger a new pin fetch.
const MIN_MOVE_KM = 0.5;

export default function MapScreen({ onRegionChangeComplete, currentUserId, focusEvent }) {
  const [pins, setPins] = useState([]);
  const [fetchError, setFetchError] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [viewingUserId, setViewingUserId] = useState(null);
  const [postedToast, setPostedToast] = useState(null); // the just-created event
  const { top: safeTop } = useSafeAreaInsets();
  const mapRef = useRef(null);
  // Refs for debounce and movement guard — never trigger re-renders.
  const debounceRef = useRef(null);
  const lastFetchRef = useRef(null); // { lat, lng, region }
  const toastTimerRef = useRef(null);

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

  // A party was just posted: fly to it, drop its pin immediately (the debounced
  // region fetch can miss it), and offer the share moment. The post's
  // confirmation used to play on the screen the host had already left.
  useEffect(() => {
    if (!focusEvent) return;
    const ev = focusEvent;
    setPins((ps) => ps.some((p) => p.id === ev.id) ? ps : [...ps, ev]);
    mapRef.current?.animateToRegion({
      latitude: ev.latitude,
      longitude: ev.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 600);
    setPostedToast(ev);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setPostedToast(null), 8000);
    return () => clearTimeout(toastTimerRef.current);
  }, [focusEvent]);

  const shareEvent = useCallback((ev) => {
    const date = ev.start_time
      ? new Date(ev.start_time).toLocaleDateString(undefined, {
          weekday: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '';
    Share.share({
      message: `${ev.title} — ${date}${ev.address ? ` · ${ev.address}` : ''} (on scene)`,
    }).catch(() => {});
  }, []);

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
      Alert.alert("couldn't open this party", 'give it another tap in a second.');
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
      Alert.alert("rsvp didn't save", 'check your connection and tap it again.');
    }
  }

  async function centerOnUser() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'location is off',
          'allow location in Settings to see parties near you.',
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
      Alert.alert("can't find you", 'allow location access in Settings to see parties near you.');
    }
  }

  const retryPins = useCallback(() => {
    fetchPins(lastFetchRef.current?.region ?? initialRegion);
  }, [fetchPins]);

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
          <EventMarker key={pin.id} pin={pin} onPress={() => openEvent(pin)} />
        ))}
      </MapView>

      <TouchableOpacity
        style={[styles.locBtn, { top: safeTop + 12 }]}
        onPress={centerOnUser}
        accessibilityRole="button"
        accessibilityLabel="center the map on your location"
      >
        <Text style={styles.locBtnText}>⊙</Text>
      </TouchableOpacity>

      {fetchError && (
        <TouchableOpacity
          style={styles.errorBanner}
          onPress={retryPins}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="couldn't load pins, tap to retry"
        >
          <Text style={styles.errorBannerText}>couldn't load the pins — tap to retry</Text>
        </TouchableOpacity>
      )}

      {postedToast && (
        <TouchableOpacity
          style={[styles.postedToast, { top: safeTop + 8 }]}
          onPress={() => { shareEvent(postedToast); setPostedToast(null); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="party posted, tap to share it"
        >
          <Text style={styles.postedToastTitle}>it's up.</Text>
          <Text style={styles.postedToastSub}>tap to send it to the group chat</Text>
        </TouchableOpacity>
      )}

      <EventDetailSheet
        event={selectedEvent}
        currentUserId={currentUserId}
        onClose={() => setSelectedEvent(null)}
        onRsvp={handleRsvp}
        onDeleted={(id) => setPins((ps) => ps.filter((p) => p.id !== id))}
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
  markerWrap: {
    alignItems: 'center',
  },
  markerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.amber,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
    maxWidth: 140,
  },
  markerChipLive: {
    borderColor: COLORS.liveGreen,
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: COLORS.liveGreen,
  },
  markerText: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  markerPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.amber,
  },
  markerPointerLive: {
    borderTopColor: COLORS.liveGreen,
  },
  locBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(17,17,17,0.9)',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locBtnText: {
    color: COLORS.amber,
    fontSize: 20,
    lineHeight: 24,
  },
  errorBanner: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBannerText: {
    color: COLORS.errorRed,
    fontSize: 14,
    fontWeight: '600',
  },
  postedToast: {
    position: 'absolute',
    left: 16, right: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.amber,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  postedToastTitle: { color: COLORS.amber, fontSize: 15, fontWeight: '700' },
  postedToastSub: { color: COLORS.inkSecondary, fontSize: 13, marginTop: 2 },
});
