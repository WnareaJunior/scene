import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from './src/api';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !password || (mode === 'register' && !username)) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      let data;
      if (mode === 'login') {
        data = await auth.login(email.trim(), password);
      } else {
        data = await auth.register(email.trim(), password, username.trim());
      }
      if (data?.error) {
        Alert.alert('Error', data.error);
      } else if (data?.accessToken) {
        onAuth(data);
      } else {
        Alert.alert('Error', 'Unexpected response. Try again.');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.logo}>scene</Text>
        <Text style={styles.sub}>find what's happening near you</Text>

        {mode === 'register' && (
          <TextInput
            style={styles.input}
            placeholder="username"
            placeholderTextColor="#555"
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="email"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor="#555"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>{mode === 'login' ? 'Sign in' : 'Create account'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.toggle}>
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  logo: {
    fontSize: 42,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: '#555',
    marginBottom: 36,
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  btn: {
    backgroundColor: '#a855f7',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  toggle: { color: '#666', textAlign: 'center', fontSize: 14 },
});
