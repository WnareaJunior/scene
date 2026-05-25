import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';

import Constants from 'expo-constants';

import { events } from '../api';

const GOOGLE_MAPS_API_KEY =
  Constants.expoConfig?.android?.config?.googleMaps?.apiKey ?? '';

function roundUpTo15(date) {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function DatePickerModal({ visible, initial, onConfirm, onCancel }) {
  const base = roundUpTo15(initial ?? new Date());
  const [hour, setHour] = useState(base.getHours());
  const [minute, setMinute] = useState(Math.floor(base.getMinutes() / 15) * 15);
  const [dayOffset, setDayOffset] = useState(0);

  const DAY_OPTIONS = [
    { label: 'Today', offset: 0 },
    { label: 'Tomorrow', offset: 1 },
    { label: '+2 days', offset: 2 },
    { label: '+3 days', offset: 3 },
  ];
  const MINUTES = [0, 15, 30, 45];

  function buildDate() {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  function changeHour(delta) {
    setHour((h) => (h + delta + 24) % 24);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={ps.overlay}>
        <View style={ps.sheet}>
          <Text style={ps.pickerTitle}>Pick a date & time</Text>

          {/* Day selector */}
          <View style={ps.row}>
            {DAY_OPTIONS.map(({ label, offset }) => (
              <TouchableOpacity
                key={offset}
                style={[ps.dayBtn, dayOffset === offset && ps.dayBtnActive]}
                onPress={() => setDayOffset(offset)}
              >
                <Text style={[ps.dayBtnText, dayOffset === offset && ps.dayBtnTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Hour selector */}
          <View style={ps.timeRow}>
            <TouchableOpacity style={ps.stepBtn} onPress={() => changeHour(-1)}>
              <Text style={ps.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={ps.timeValue}>
              {String(hour % 12 || 12).padStart(2, '0')} {hour < 12 ? 'AM' : 'PM'}
            </Text>
            <TouchableOpacity style={ps.stepBtn} onPress={() => changeHour(1)}>
              <Text style={ps.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Minute selector */}
          <View style={ps.row}>
            {MINUTES.map((m) => (
              <TouchableOpacity
                key={m}
                style={[ps.minBtn, minute === m && ps.minBtnActive]}
                onPress={() => setMinute(m)}
              >
                <Text style={[ps.minBtnText, minute === m && ps.minBtnTextActive]}>
                  :{String(m).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={ps.actions}>
            <TouchableOpacity style={ps.cancelBtn} onPress={onCancel}>
              <Text style={ps.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ps.confirmBtn} onPress={() => onConfirm(buildDate())}>
              <Text style={ps.confirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function CreateScreen({ viewport, onCreated }) {
  const [form, setForm] = useState({
    title: '', address: '', startTime: null, capacity: '',
  });
  const [hashtags, setHashtags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);

  const mapRef = useRef(null);
  const placesRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        setSelectedLocation((prev) => prev ?? coords);
        mapRef.current?.animateToRegion({
          ...coords,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 600);
      } catch {
        // Intentionally silent: location is optional on the Create screen.
        // The user can still set a location via the address autocomplete or by
        // panning the embedded map — failing to get GPS coords is not an error
        // the user needs to act on at this point.
      }
    })();
  }, []);

  const initialRegion = (() => {
    const center = selectedLocation ?? viewport;
    if (!center) return {
      latitude: 40.7128, longitude: -74.006,
      latitudeDelta: 0.01, longitudeDelta: 0.01,
    };
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  })();

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, '');
    if (!tag || hashtags.includes(tag) || hashtags.length >= 5) return;
    setHashtags((t) => [...t, tag]);
    setTagInput('');
  }

  function removeTag(tag) {
    setHashtags((t) => t.filter((x) => x !== tag));
  }

  async function handleSubmit() {
    if (!form.title || !form.startTime) {
      Alert.alert('Missing fields', 'Title and start time are required.');
      return;
    }
    const locationToSubmit = selectedLocation ?? viewport;
    if (!locationToSubmit) {
      Alert.alert('Location needed', 'Search an address or pan the map to set event location.');
      return;
    }
    setCreating(true);
    let created = false;
    try {
      const data = await events.create({
        title: form.title,
        address: form.address,
        startTime: form.startTime.toISOString(),
        latitude: locationToSubmit.latitude,
        longitude: locationToSubmit.longitude,
        capacity: form.capacity ? parseInt(form.capacity, 10) : undefined,
        hashtags,
      });
      if (data?.id) {
        created = true;
        setForm({ title: '', address: '', startTime: null, capacity: '' });
        setHashtags([]);
        setTagInput('');
        setSelectedLocation(null);
        placesRef.current?.setAddressText('');
        // Navigate away first, then show confirmation so we don't update
        // state on an unmounted component.
        onCreated();
        Alert.alert('Created!', `"${data.title}" is live.`);
      } else {
        Alert.alert('Error', data?.error || 'Could not create event.');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Something went wrong. Please try again.');
    } finally {
      // Only reset the loading spinner if we haven't navigated away,
      // to avoid a state update on an unmounted component.
      if (!created) setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeContent}>
      <ScrollView
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>create event</Text>

        <TextInput
          style={styles.input} placeholder="title" placeholderTextColor="#555"
          value={form.title} onChangeText={(v) => setField('title', v)}
        />

        {/* Address autocomplete */}
        <View style={styles.autocompleteContainer}>
          <GooglePlacesAutocomplete
            ref={placesRef}
            placeholder="address"
            fetchDetails
            onPress={(data, details) => {
              const lat = details?.geometry?.location?.lat;
              const lng = details?.geometry?.location?.lng;
              if (lat && lng) {
                const coords = { latitude: lat, longitude: lng };
                setSelectedLocation(coords);
                setField('address', data.description);
                mapRef.current?.animateToRegion({
                  ...coords,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }, 600);
              }
            }}
            query={{ key: GOOGLE_MAPS_API_KEY, language: 'en' }}
            styles={{
              textInputContainer: styles.placesInputContainer,
              textInput: styles.placesInput,
              listView: styles.placesList,
              row: styles.placesRow,
              description: styles.placesDescription,
              separator: styles.placesSeparator,
              poweredContainer: { display: 'none' },
            }}
            enablePoweredByContainer={false}
            minLength={2}
            debounce={300}
            textInputProps={{ placeholderTextColor: '#555' }}
          />
        </View>

        {/* Embedded location map */}
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            customMapStyle={darkMapStyle}
            initialRegion={initialRegion}
            onRegionChangeComplete={(region) => {
              setSelectedLocation({
                latitude: region.latitude,
                longitude: region.longitude,
              });
            }}
            showsUserLocation
            showsMyLocationButton={false}
            scrollEnabled
            zoomEnabled
          />
          {/* Crosshair overlay */}
          <View style={styles.crosshairOuter} pointerEvents="none">
            <View style={styles.crosshairH} />
            <View style={styles.crosshairV} />
            <View style={styles.crosshairDot} />
          </View>
        </View>

        {/* Start time picker */}
        <TouchableOpacity
          style={styles.input}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.7}
        >
          <Text style={form.startTime ? styles.inputText : styles.inputPlaceholder}>
            {form.startTime ? formatDate(form.startTime) : 'start time'}
          </Text>
        </TouchableOpacity>
        <DatePickerModal
          visible={showPicker}
          initial={form.startTime}
          onConfirm={(date) => { setField('startTime', date); setShowPicker(false); }}
          onCancel={() => setShowPicker(false)}
        />

        <TextInput
          style={styles.input} placeholder="capacity (optional)" placeholderTextColor="#555"
          keyboardType="number-pad"
          value={form.capacity} onChangeText={(v) => setField('capacity', v)}
        />

        {/* Tags input */}
        <TextInput
          style={styles.input}
          placeholder={hashtags.length >= 5 ? 'max 5 tags' : 'add tag (e.g. music)'}
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          value={tagInput}
          onChangeText={setTagInput}
          onSubmitEditing={addTag}
          editable={hashtags.length < 5}
        />
        {hashtags.length > 0 && (
          <View style={styles.chipsRow}>
            {hashtags.map((tag) => (
              <View key={tag} style={styles.chip}>
                <Text style={styles.chipText}>#{tag}</Text>
                <TouchableOpacity onPress={() => removeTag(tag)} hitSlop={8}>
                  <Text style={styles.chipRemove}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.createBtn} onPress={handleSubmit} disabled={creating}>
          {creating
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.createBtnText}>Post event</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContent: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  screenTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20, marginTop: 16 },

  input: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    padding: 13, fontSize: 15, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
    justifyContent: 'center',
  },
  inputText: { color: '#fff', fontSize: 15 },
  inputPlaceholder: { color: '#555', fontSize: 15 },

  autocompleteContainer: {
    zIndex: 10,
    elevation: 10,
    marginBottom: 10,
  },
  placesInputContainer: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  placesInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    color: '#fff',
    height: 48,
    paddingHorizontal: 13,
  },
  placesList: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    marginTop: 2,
  },
  placesRow: {
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  placesDescription: { color: '#ccc', fontSize: 14 },
  placesSeparator: { backgroundColor: '#2a2a2a', height: 1 },

  mapContainer: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    zIndex: 1,
    elevation: 1,
  },
  crosshairOuter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairH: {
    position: 'absolute',
    width: 20,
    height: 1.5,
    backgroundColor: '#a855f7',
  },
  crosshairV: {
    position: 'absolute',
    width: 1.5,
    height: 20,
    backgroundColor: '#a855f7',
  },
  crosshairDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#a855f7',
  },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10, marginTop: -2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#2a1a3e', borderRadius: 20,
    paddingVertical: 5, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#a855f7',
  },
  chipText: { color: '#a855f7', fontSize: 13, fontWeight: '600' },
  chipRemove: { color: '#a855f7', fontSize: 16, lineHeight: 18 },

  createBtn: {
    backgroundColor: '#a855f7', borderRadius: 10,
    padding: 15, alignItems: 'center', marginTop: 8,
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

const ps = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  pickerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  dayBtn: {
    flex: 1, marginHorizontal: 3, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1e1e1e', alignItems: 'center',
  },
  dayBtnActive: { backgroundColor: '#2a1a3e', borderWidth: 1, borderColor: '#a855f7' },
  dayBtnText: { color: '#555', fontSize: 13, fontWeight: '600' },
  dayBtnTextActive: { color: '#a855f7' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1e1e1e',
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { color: '#fff', fontSize: 22, lineHeight: 26 },
  timeValue: { color: '#fff', fontSize: 28, fontWeight: '700', minWidth: 100, textAlign: 'center' },
  minBtn: {
    flex: 1, marginHorizontal: 3, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1e1e1e', alignItems: 'center',
  },
  minBtnActive: { backgroundColor: '#2a1a3e', borderWidth: 1, borderColor: '#a855f7' },
  minBtnText: { color: '#555', fontSize: 15, fontWeight: '600' },
  minBtnTextActive: { color: '#a855f7' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#1e1e1e',
  },
  cancelText: { color: '#888', fontWeight: '600' },
  confirmBtn: {
    flex: 1, padding: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#a855f7',
  },
  confirmText: { color: '#fff', fontWeight: '700' },
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
