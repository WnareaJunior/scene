import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, ScrollView, Platform, Image, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

import { events } from '../api';
import { darkMapStyle } from '../constants/mapStyles';
import { COLORS } from '../constants/colors';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';

const GAP = 14;
// Parties default to 4 hours: without an end time, "live" can never happen.
const DEFAULT_DURATION_MS = 4 * 3600000;

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Quick-pick times for the dominant case. "tonight 10pm" only exists while
// 10pm is still ahead; late-night posting falls back to "in 2 hours".
function quickTimes() {
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(22, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(22, 0, 0, 0);
  const soon = new Date(now.getTime() + 2 * 3600000);
  soon.setMinutes(0, 0, 0);

  const first = tonight > now
    ? { label: 'tonight 10pm', value: tonight }
    : { label: 'in 2 hours', value: soon };
  return [first, { label: 'tomorrow 10pm', value: tomorrow }];
}

export default function CreateScreen({ viewport, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', address: '', startTime: null, capacity: '',
  });
  const [hashtags, setHashtags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  // date picker: 'date' | 'time' | null
  const [pickerMode, setPickerMode] = useState(null);
  // Temp date used while the native picker is open on Android (two-step flow)
  const [pickerDate, setPickerDate] = useState(new Date());
  const [creating, setCreating] = useState(false);
  const [posted, setPosted] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [mapScrollLocked, setMapScrollLocked] = useState(false);
  const [partyImage, setPartyImage] = useState(null);
  const [showMore, setShowMore] = useState(false);

  const mapRef = useRef(null);
  const placesRef = useRef(null);
  const reverseGeocodeTimeoutRef = useRef(null);

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

  // Cleanup reverse-geocode timeout on unmount.
  useEffect(() => () => clearTimeout(reverseGeocodeTimeoutRef.current), []);

  const initialRegion = useMemo(() => {
    const center = selectedLocation ?? viewport;
    if (!center) return { latitude: 40.7128, longitude: -74.006, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    return { latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
  }, [selectedLocation, viewport]);

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

  // Reverse-geocode a lat/lng via Google Geocoding API and update the address field.
  const reverseGeocode = useCallback(async (latitude, longitude) => {
    if (!GOOGLE_MAPS_API_KEY) return;
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const formatted = json?.results?.[0]?.formatted_address;
      if (formatted) {
        setField('address', formatted);
        placesRef.current?.setAddressText(formatted);
      }
    } catch {
      // Non-fatal: the pinned coordinates still submit without a pretty address.
    }
  }, []);

  const handleRegionChangeComplete = useCallback((region) => {
    const coords = { latitude: region.latitude, longitude: region.longitude };
    setSelectedLocation(coords);
    if (reverseGeocodeTimeoutRef.current) clearTimeout(reverseGeocodeTimeoutRef.current);
    reverseGeocodeTimeoutRef.current = setTimeout(() => {
      reverseGeocode(coords.latitude, coords.longitude);
    }, 600);
  }, [reverseGeocode]);

  // Native date/time picker handler.
  // On iOS the spinner is inline; on Android we do a two-step date → time flow.
  function handleDateChange(event, selected) {
    if (event.type === 'dismissed') {
      setPickerMode(null);
      return;
    }
    if (!selected) return;

    if (Platform.OS === 'android') {
      if (pickerMode === 'date') {
        // Keep the selected date, now open the time picker.
        setPickerDate(selected);
        setPickerMode('time');
      } else {
        // Combine the date chosen in step 1 with the time chosen here.
        const combined = new Date(pickerDate);
        combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        setField('startTime', combined);
        setPickerMode(null);
      }
    } else {
      // iOS spinner fires onChange on every wheel tick — track the value but
      // keep the picker open; the Done button (or re-tapping the field) commits.
      setPickerDate(selected);
    }
  }

  function confirmIosPicker() {
    setField('startTime', pickerDate);
    setPickerMode(null);
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('photos access needed', 'allow photo access in Settings to add a party photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled) {
      setPartyImage(result.assets[0].uri);
    }
  }

  function openDatePicker() {
    if (Platform.OS === 'ios' && pickerMode !== null) {
      // Tapping the field while the spinner is open commits the current value.
      confirmIosPicker();
      return;
    }
    const base = form.startTime ?? new Date();
    setPickerDate(base);
    setPickerMode(Platform.OS === 'ios' ? 'datetime' : 'date');
  }

  async function handleSubmit() {
    if (!form.title || !form.startTime) {
      Alert.alert('not quite ready', 'add a title and a start time, then post.');
      return;
    }
    const locationToSubmit = selectedLocation ?? viewport;
    if (!locationToSubmit) {
      Alert.alert("where's the party?", 'search an address or pan the map until the crosshair is on the spot.');
      return;
    }
    let capacity;
    if (form.capacity) {
      const parsed = parseInt(form.capacity, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        Alert.alert('capacity looks off', 'use a whole number of 1 or more — or leave it blank for no cap.');
        return;
      }
      capacity = parsed;
    }

    setCreating(true);
    try {
      let imageUrl;
      if (partyImage) {
        const uploaded = await events.uploadImage(partyImage);
        imageUrl = uploaded.url;
      }
      const data = await events.create({
        title: form.title,
        description: form.description || undefined,
        address: form.address,
        startTime: form.startTime.toISOString(),
        endTime: new Date(form.startTime.getTime() + DEFAULT_DURATION_MS).toISOString(),
        latitude: locationToSubmit.latitude,
        longitude: locationToSubmit.longitude,
        capacity,
        hashtags,
        imageUrl,
      });
      if (data?.id) {
        setForm({ title: '', description: '', address: '', startTime: null, capacity: '' });
        setHashtags([]);
        setTagInput('');
        setSelectedLocation(null);
        setPartyImage(null);
        setShowMore(false);
        placesRef.current?.setAddressText('');
        setPosted(true);
        onCreated(data);
        setTimeout(() => setPosted(false), 2500);
      } else {
        Alert.alert("couldn't post the party", data?.error || 'try again in a second.');
      }
    } catch (err) {
      Alert.alert("couldn't post the party", err.message || 'try again in a second.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeContent}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!mapScrollLocked}
        >
          <Text style={styles.screenTitle}>post a party</Text>

          {/* ── the what ─────────────────────────────────────────────── */}
          <TextInput
            style={styles.input}
            placeholder="title"
            placeholderTextColor={COLORS.inkSecondary}
            value={form.title}
            onChangeText={(v) => setField('title', v)}
            accessibilityLabel="party title"
          />

          <TouchableOpacity
            style={styles.imagePicker}
            onPress={pickImage}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={partyImage ? 'change the party photo' : 'add a party photo'}
          >
            {partyImage ? (
              <Image source={{ uri: partyImage }} style={styles.partyImage} resizeMode="cover" />
            ) : (
              <View style={styles.imagePickerPlaceholder}>
                <Text style={styles.imagePickerIcon}>+</Text>
                <Text style={styles.imagePickerText}>add party photo</Text>
              </View>
            )}
          </TouchableOpacity>

          <TextInput
            style={[styles.input, styles.descriptionInput]}
            placeholder="set the vibe — byob? theme? side door?"
            placeholderTextColor={COLORS.inkSecondary}
            value={form.description}
            onChangeText={(v) => setField('description', v)}
            multiline
            maxLength={500}
            accessibilityLabel="party description"
          />

          {/* ── the where ────────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>the where</Text>
          {/* Address autocomplete — zIndex lets dropdown overlay elements below */}
          <View style={styles.autocompleteContainer}>
            <GooglePlacesAutocomplete
              ref={placesRef}
              placeholder="address"
              fetchDetails
              onPress={async (data, details) => {
                setField('address', data.description);
                let loc = details?.geometry?.location;
                if (!loc?.lat || !loc?.lng) {
                  // Place Details failed or came back thin — geocode the
                  // description so the tap still lands somewhere.
                  try {
                    const res = await fetch(
                      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(data.description)}&key=${GOOGLE_MAPS_API_KEY}`,
                    );
                    const json = await res.json();
                    loc = json?.results?.[0]?.geometry?.location;
                  } catch {
                    // fall through to the alert below
                  }
                }
                if (loc?.lat && loc?.lng) {
                  const coords = { latitude: loc.lat, longitude: loc.lng };
                  setSelectedLocation(coords);
                  mapRef.current?.animateToRegion(
                    { ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 },
                    600,
                  );
                } else {
                  Alert.alert(
                    "couldn't pin that address",
                    'pan the map to set the spot instead.',
                  );
                }
              }}
              onFail={() => Alert.alert("address search isn't working", 'pan the map to drop the pin instead.')}
              onNotFound={() => Alert.alert('no matches for that address', 'try fewer words, or pan the map to the spot.')}
              onTimeout={() => Alert.alert("address search isn't working", 'pan the map to drop the pin instead.')}
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
              keyboardShouldPersistTaps="always"
              textInputProps={{ placeholderTextColor: COLORS.inkSecondary }}
            />
          </View>

          {/* Embedded location map — directly under the address it sets */}
          <View
            style={styles.mapContainer}
            onTouchStart={() => setMapScrollLocked(true)}
            onTouchEnd={() => setMapScrollLocked(false)}
            onTouchCancel={() => setMapScrollLocked(false)}
          >
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              customMapStyle={darkMapStyle}
              userInterfaceStyle="dark"
              initialRegion={initialRegion}
              onRegionChangeComplete={handleRegionChangeComplete}
              showsUserLocation
              showsMyLocationButton={false}
              scrollEnabled
              zoomEnabled
            />
            <View style={styles.crosshairOuter} pointerEvents="none">
              <View style={styles.crosshairH} />
              <View style={styles.crosshairV} />
              <View style={styles.crosshairDot} />
            </View>
          </View>

          {/* ── the when ─────────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>the when</Text>
          <View style={styles.timeRow}>
            {quickTimes().map(({ label, value }) => {
              const selected = form.startTime?.getTime() === value.getTime();
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.timeChip, selected && styles.timeChipActive]}
                  onPress={() => { setField('startTime', value); setPickerMode(null); }}
                  accessibilityRole="button"
                  accessibilityLabel={`start ${label}`}
                >
                  <Text style={[styles.timeChipText, selected && styles.timeChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.timeChip}
              onPress={openDatePicker}
              accessibilityRole="button"
              accessibilityLabel="pick a start time"
            >
              <Text style={styles.timeChipText}>pick a time</Text>
            </TouchableOpacity>
          </View>
          {form.startTime && (
            <TouchableOpacity onPress={openDatePicker} accessibilityRole="button" accessibilityLabel="change the start time">
              <Text style={styles.timeChosen}>starts {formatDate(form.startTime)}</Text>
            </TouchableOpacity>
          )}
          {pickerMode !== null && (
            <DateTimePicker
              value={pickerDate}
              mode={pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={new Date()}
              onChange={handleDateChange}
              themeVariant="dark"
            />
          )}
          {pickerMode !== null && Platform.OS === 'ios' && (
            <View style={styles.pickerDoneRow}>
              <TouchableOpacity
                style={styles.pickerDoneBtn}
                onPress={confirmIosPicker}
                accessibilityRole="button"
                accessibilityLabel="confirm start time"
              >
                <Text style={styles.pickerDoneText}>done</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── more (optional) ──────────────────────────────────────── */}
          <TouchableOpacity
            style={styles.moreToggle}
            onPress={() => setShowMore((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={showMore ? 'hide capacity and tags' : 'show capacity and tags'}
          >
            <Text style={styles.moreToggleText}>{showMore ? '− less' : '+ capacity & tags'}</Text>
          </TouchableOpacity>

          {showMore && (
            <>
              <TextInput
                style={styles.input}
                placeholder="capacity (optional)"
                placeholderTextColor={COLORS.inkSecondary}
                keyboardType="number-pad"
                value={form.capacity}
                onChangeText={(v) => setField('capacity', v)}
                accessibilityLabel="capacity, optional"
              />

              <TextInput
                style={styles.input}
                placeholder={hashtags.length >= 5 ? 'max 5 tags' : 'add tag (e.g. music)'}
                placeholderTextColor={COLORS.inkSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                editable={hashtags.length < 5}
                accessibilityLabel="add a tag"
              />
              {hashtags.length > 0 && (
                <View style={styles.chipsRow}>
                  {hashtags.map((tag) => (
                    <View key={tag} style={styles.chip}>
                      <Text style={styles.chipText}>#{tag}</Text>
                      <TouchableOpacity
                        onPress={() => removeTag(tag)}
                        hitSlop={14}
                        accessibilityRole="button"
                        accessibilityLabel={`remove tag ${tag}`}
                      >
                        <Text style={styles.chipRemove}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          <TouchableOpacity
            style={[styles.createBtn, posted && styles.createBtnPosted]}
            onPress={handleSubmit}
            disabled={creating || posted}
            accessibilityRole="button"
            accessibilityLabel="post the party"
          >
            {creating
              ? <ActivityIndicator color={COLORS.amberInk} />
              : <Text style={styles.createBtnText}>{posted ? 'party posted!' : 'post party'}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContent: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  screenTitle: { color: COLORS.ink, fontSize: 28, fontWeight: '800', marginBottom: GAP },
  sectionLabel: {
    color: COLORS.inkSecondary, fontSize: 13, fontWeight: '600',
    marginBottom: 8, marginTop: 4,
  },
  autocompleteContainer: {
    zIndex: 100,
    elevation: 100,
    marginBottom: GAP,
  },

  input: {
    backgroundColor: COLORS.card, borderRadius: 10,
    padding: 13, fontSize: 15, marginBottom: GAP,
    borderWidth: 1, borderColor: COLORS.border,
    justifyContent: 'center',
    color: COLORS.ink,
  },
  descriptionInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },

  placesInputContainer: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  placesInput: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.ink,
    padding: 13,
  },
  placesList: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    marginTop: 2,
  },
  placesRow: {
    backgroundColor: COLORS.card,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  placesDescription: { color: COLORS.ink, fontSize: 14 },
  placesSeparator: { backgroundColor: COLORS.border, height: 1 },

  imagePicker: {
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: GAP,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  partyImage: {
    width: '100%',
    height: '100%',
  },
  imagePickerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  imagePickerIcon: {
    color: COLORS.inkSecondary,
    fontSize: 32,
    lineHeight: 36,
  },
  imagePickerText: {
    color: COLORS.inkSecondary,
    fontSize: 14,
  },

  mapContainer: {
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: GAP,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.amber,
  },
  crosshairV: {
    position: 'absolute',
    width: 1.5,
    height: 20,
    backgroundColor: COLORS.amber,
  },
  crosshairDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.amber,
  },

  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  timeChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeChipActive: {
    backgroundColor: COLORS.amberTint,
    borderColor: COLORS.amber,
  },
  timeChipText: { color: COLORS.ink, fontSize: 14, fontWeight: '600' },
  timeChipTextActive: { color: COLORS.amber },
  timeChosen: { color: COLORS.amber, fontSize: 14, fontWeight: '600', marginBottom: GAP },

  pickerDoneRow: {
    alignItems: 'flex-end',
    marginBottom: GAP,
  },
  pickerDoneBtn: {
    backgroundColor: COLORS.amber,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerDoneText: { color: COLORS.amberInk, fontWeight: '700', fontSize: 15 },

  moreToggle: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 4,
  },
  moreToggleText: { color: COLORS.inkSecondary, fontSize: 14, fontWeight: '600' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: GAP },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.amberTint, borderRadius: 20,
    paddingVertical: 5, paddingHorizontal: 10,
    borderWidth: 1, borderColor: COLORS.amber,
  },
  chipText: { color: COLORS.amber, fontSize: 13, fontWeight: '600' },
  chipRemove: { color: COLORS.amber, fontSize: 16, lineHeight: 18 },

  createBtn: {
    backgroundColor: COLORS.amber, borderRadius: 10,
    minHeight: 50, alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
  },
  createBtnPosted: {
    backgroundColor: COLORS.amberPressed,
  },
  createBtnText: { color: COLORS.amberInk, fontWeight: '700', fontSize: 16 },
});
