import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from './src/api';
import { COLORS } from './src/constants/colors';
import { isWeb, getPath, pushPath, onPathChange } from './src/urlSync';

// Mirrors the backend's checks (routes/auth.js) so obvious mistakes surface
// inline before a network round-trip. Errors render as text under the form —
// Alert.alert is a no-op on react-native-web, and inline copy is what the
// e2e suite asserts against.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function modeFromPath(path) {
  return path === '/signup' ? 'register' : 'login';
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState(isWeb ? modeFromPath(getPath()) : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  // Web: back/forward between /login and /signup switches the form.
  useEffect(() => {
    if (!isWeb) return undefined;
    return onPathChange((path) => {
      if (path === '/login' || path === '/signup') setMode(modeFromPath(path));
    });
  }, []);

  function toggleMode() {
    const next = mode === 'login' ? 'register' : 'login';
    setMode(next);
    setFieldErrors({});
    setFormError(null);
    if (isWeb) pushPath(next === 'register' ? '/signup' : '/login');
  }

  function validate() {
    const errors = {};
    if (mode === 'register' && !username.trim()) {
      errors.username = 'pick a username.';
    }
    if (!email.trim()) {
      errors.email = 'email is required.';
    } else if (mode === 'register' && !EMAIL_RE.test(email.trim())) {
      errors.email = "that doesn't look like an email.";
    }
    if (!password) {
      errors.password = 'password is required.';
    } else if (mode === 'register' && password.length < 8) {
      errors.password = 'password needs at least 8 characters.';
    }
    return errors;
  }

  async function submit() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      let data;
      if (mode === 'login') {
        data = await auth.login(email.trim(), password);
      } else {
        data = await auth.register(email.trim(), password, username.trim());
      }
      if (data?.error) {
        setFormError(data.error);
      } else if (data?.accessToken) {
        onAuth(data);
      } else {
        setFormError('the server sent back something odd — try again.');
      }
    } catch (err) {
      setFormError(err.message || 'try again in a second.');
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
          <>
            <TextInput
              style={styles.input}
              placeholder="username"
              placeholderTextColor={COLORS.inkSecondary}
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
              testID="auth-username-input"
              accessibilityLabel="username"
            />
            {fieldErrors.username ? (
              <Text style={styles.fieldError} testID="auth-username-error">{fieldErrors.username}</Text>
            ) : null}
          </>
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
          testID="auth-email-input"
          accessibilityLabel="email"
        />
        {fieldErrors.email ? (
          <Text style={styles.fieldError} testID="auth-email-error">{fieldErrors.email}</Text>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor={COLORS.inkSecondary}
          secureTextEntry
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChangeText={setPassword}
          testID="auth-password-input"
          accessibilityLabel="password"
        />
        {fieldErrors.password ? (
          <Text style={styles.fieldError} testID="auth-password-error">{fieldErrors.password}</Text>
        ) : null}

        {formError ? (
          <Text style={styles.formError} testID="auth-form-error">{formError}</Text>
        ) : null}

        <TouchableOpacity
          style={styles.btn}
          onPress={submit}
          disabled={loading}
          testID="auth-submit"
          accessibilityRole="button"
          accessibilityLabel={mode === 'login' ? 'sign in' : 'create account'}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.accentInk} />
          ) : (
            <Text style={styles.btnText}>{mode === 'login' ? 'sign in' : 'create account'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleMode}
          disabled={loading}
          style={styles.toggleBtn}
          testID="auth-toggle"
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
  // maxWidth only bites on desktop web — phones are narrower than 480pt, so
  // the native layout is unchanged.
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
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
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldError: {
    color: COLORS.errorRed,
    fontSize: 13,
    marginTop: -6,
    marginBottom: 12,
  },
  formError: {
    color: COLORS.errorRed,
    fontSize: 13,
    marginBottom: 8,
  },
  btn: {
    backgroundColor: COLORS.accent,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  btnText: { color: COLORS.accentInk, fontWeight: '700', fontSize: 16 },
  toggleBtn: { minHeight: 44, justifyContent: 'center' },
  toggle: { color: COLORS.inkSecondary, textAlign: 'center', fontSize: 14 },
  toggleDisabled: { opacity: 0.4 },
});
