import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { events } from '../api';

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
    if (!viewport) {
      Alert.alert('Location needed', 'Pan the map to set event location.');
      return;
    }
    setCreating(true);
    try {
      const data = await events.create({
        title: form.title,
        address: form.address,
        startTime: form.startTime.toISOString(),
        latitude: viewport.latitude,
        longitude: viewport.longitude,
        capacity: form.capacity ? parseInt(form.capacity) : undefined,
        hashtags,
      });
      if (data?.id) {
        Alert.alert('Created!', `"${data.title}" is live.`);
        setForm({ title: '', address: '', startTime: null, capacity: '' });
        setHashtags([]);
        setTagInput('');
        onCreated();
      } else {
        Alert.alert('Error', data?.error || 'Could not create event.');
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    }
    setCreating(false);
  }

  return (
    <SafeAreaView style={styles.safeContent}>
      <Text style={styles.screenTitle}>create event</Text>
      <Text style={styles.createHint}>Location: map center</Text>

      <TextInput
        style={styles.input} placeholder="title" placeholderTextColor="#555"
        value={form.title} onChangeText={(v) => setField('title', v)}
      />
      <TextInput
        style={styles.input} placeholder="address (display only)" placeholderTextColor="#555"
        value={form.address} onChangeText={(v) => setField('address', v)}
      />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContent: { flex: 1, paddingHorizontal: 24 },
  screenTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20, marginTop: 16 },
  createHint: { color: '#555', fontSize: 13, marginBottom: 16, marginTop: -8 },
  input: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    padding: 13, fontSize: 15, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
    justifyContent: 'center',
  },
  inputText: { color: '#fff', fontSize: 15 },
  inputPlaceholder: { color: '#555', fontSize: 15 },
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
