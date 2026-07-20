import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from './src/api';
import { COLORS } from './src/constants/colors';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !password || (mode === 'register' && !username)) {
      Alert.alert(
        'missing something',
        mode === 'register' ? 'username, email, and password — all three.' : 'email and password — both.',
      );
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
      const failTitle = mode === 'login' ? "couldn't sign you in" : "couldn't create your account";
      if (data?.error) {
        Alert.alert(failTitle, data.error);
      } else if (data?.accessToken) {
        onAuth(data);
      } else {
        Alert.alert(failTitle, 'the server sent back something odd — try again.');
      }
    } catch (err) {
      const failTitle = mode === 'login' ? "couldn't sign you in" : "couldn't create your account";
      Alert.alert(failTitle, err.message || 'try again in a second.');
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
        <Text style={styles.sub}>see tonight on a map</Text>

        {mode === 'register' && (
          <TextInput
            style={styles.input}
            placeholder="username"
            placeholderTextColor={COLORS.inkSecondary}
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="email"
          placeholderTextColor={COLORS.inkSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor={COLORS.inkSecondary}
          secureTextEntry
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={COLORS.amberInk} />
          ) : (
            <Text style={styles.btnText}>{mode === 'login' ? 'sign in' : 'create account'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
          disabled={loading}
          style={styles.toggleBtn}
          accessibilityRole="button"
          accessibilityLabel={mode === 'login' ? 'switch to sign up' : 'switch to sign in'}
        >
          <Text style={[styles.toggle, loading && styles.toggleDisabled]}>
            {mode === 'login' ? "don't have an account? sign up" : 'already have an account? sign in'}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.asphalt },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  logo: {
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.ink,
    letterSpacing: -1,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: COLORS.inkSecondary,
    marginBottom: 36,
  },
  input: {
    backgroundColor: COLORS.card,
    color: COLORS.ink,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btn: {
    backgroundColor: COLORS.amber,
    borderRadius: 10,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  btnText: { color: COLORS.amberInk, fontWeight: '700', fontSize: 16 },
  toggleBtn: { minHeight: 44, justifyContent: 'center' },
  toggle: { color: COLORS.inkSecondary, textAlign: 'center', fontSize: 14 },
  toggleDisabled: { opacity: 0.4 },
});
