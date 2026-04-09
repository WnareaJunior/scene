import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { events } from '../api';

export default function CreateScreen({ viewport, onCreated }) {
  const [form, setForm] = useState({
    title: '', address: '', startTime: '', capacity: '', hashtag: '',
  });
  const [creating, setCreating] = useState(false);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
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
        startTime: form.startTime,
        latitude: viewport.latitude,
        longitude: viewport.longitude,
        capacity: form.capacity ? parseInt(form.capacity) : undefined,
        hashtags: form.hashtag ? [form.hashtag] : [],
      });
      if (data?.id) {
        Alert.alert('Created!', `"${data.title}" is live.`);
        setForm({ title: '', address: '', startTime: '', capacity: '', hashtag: '' });
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
      <TextInput
        style={styles.input}
        placeholder="start time (ISO 8601: 2024-06-01T20:00:00Z)"
        placeholderTextColor="#555"
        value={form.startTime} onChangeText={(v) => setField('startTime', v)}
      />
      <TextInput
        style={styles.input} placeholder="capacity (optional)" placeholderTextColor="#555"
        keyboardType="number-pad"
        value={form.capacity} onChangeText={(v) => setField('capacity', v)}
      />
      <TextInput
        style={styles.input} placeholder="category tag (e.g. music)" placeholderTextColor="#555"
        autoCapitalize="none"
        value={form.hashtag} onChangeText={(v) => setField('hashtag', v)}
      />

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
