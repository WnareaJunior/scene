import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { map as mapApi } from '../api';

const initialRegion = {
  latitude: 40.7128, longitude: -74.006,
  latitudeDelta: 0.05, longitudeDelta: 0.05,
};

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

export default function MapScreen({ onRegionChangeComplete }) {
  const [pins, setPins] = useState([]);
  const [fetchError, setFetchError] = useState(false);
  const mapRef = useRef(null);

  async function fetchPins(region) {
    try {
      const data = await mapApi.eventPins(regionToBounds(region));
      setPins(Array.isArray(data) ? data : []);
      setFetchError(false);
    } catch {
      setFetchError(true);
    }
  }

  useEffect(() => { fetchPins(initialRegion); }, []);

  const handleRegionChange = useCallback(async (region) => {
    onRegionChangeComplete(region);
    fetchPins(region);
  }, [onRegionChangeComplete]);

  async function centerOnUser() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 600);
    } catch {}
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        customMapStyle={darkMapStyle}
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
