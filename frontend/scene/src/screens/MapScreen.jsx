import React, { useState, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { events } from '../api';

export default function MapScreen({ onRegionChangeComplete }) {
  const [pins, setPins] = useState([]);

  const handleRegionChange = useCallback(async (region) => {
    onRegionChangeComplete(region);

    try {
      const data = await events.discover({
        lat: region.latitude,
        lng: region.longitude,
        radius: 5000,
        limit: 10,
      });
      setPins(Array.isArray(data) ? data : []);
    } catch {}
  }, [onRegionChangeComplete]);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      customMapStyle={darkMapStyle}
      initialRegion={{
        latitude: 40.7128, longitude: -74.006,
        latitudeDelta: 0.05, longitudeDelta: 0.05,
      }}
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
  );
}

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
