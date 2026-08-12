import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AsyncStorage from '@react-native-async-storage/async-storage';

import AuthScreen from './AuthScreen';
import Scene from './Scene';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { COLORS } from './src/constants/colors';
import { users, auth, saveTokens, getStoredToken, clearTokens } from './src/api';
import { isWeb, getPath, replacePath, onPathChange } from './src/urlSync';

const ONBOARDING_KEY = 'scene.onboarding.v1.seen';
const AUTH_PATHS = ['/login', '/signup'];

class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorFallback}>
          <Text style={styles.errorFallbackText}>scene hit a snag — restart to keep going</Text>
          <TouchableOpacity
            style={styles.restartBtn}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={styles.restartBtnText}>restart</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);

  // Web auth guard: unauthenticated hits on app routes land on /login;
  // authenticated users never see /login, /signup, or a bare /. Native: no-op
  // (isWeb is false and the effect returns immediately).
  useEffect(() => {
    if (!isWeb || loading) return undefined;
    const guard = () => {
      const path = getPath();
      if (!user && !AUTH_PATHS.includes(path)) {
        replacePath('/login');
      } else if (user && (path === '/' || AUTH_PATHS.includes(path))) {
        replacePath('/feed');
      }
    };
    guard();
    return onPathChange(guard);
  }, [user, loading]);

  async function bootstrap() {
    try {
      // Web skips the swipe-through intro — it's built around native gestures,
      // and the web v1 surface (feed + profile) doesn't need it.
      const seen = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null);
      setOnboarded(isWeb || seen === '1');
      const token = await getStoredToken();
      if (token) {
        const me = await users.me();
        if (me && me.id) {
          setUser(me);
        } else {
          await clearTokens();
        }
      }
    } catch {
      // Intentionally silent: bootstrap runs before any UI is visible.
      // Any error (network, SecureStore) simply means the stored session
      // cannot be restored; clearing tokens and showing AuthScreen is the
      // correct recovery — no Alert is appropriate at this point.
      await clearTokens();
    } finally {
      setLoading(false);
    }
  }

  async function handleAuth(data) {
    await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
  }

  function handleOnboardingDone() {
    setOnboarded(true);
    // Fire-and-forget: losing the flag just replays the intro next launch.
    AsyncStorage.setItem(ONBOARDING_KEY, '1').catch(() => {});
  }

  async function handleSignOut() {
    // Ensure tokens are always wiped even if the caller already called
    // auth.logout() — clearTokens() is idempotent.
    await clearTokens();
    setUser(null);
  }

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {!onboarded ? (
            <OnboardingScreen onDone={handleOnboardingDone} />
          ) : user ? (
            <Scene user={user} onSignOut={handleSignOut} />
          ) : (
            <AuthScreen onAuth={handleAuth} />
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: COLORS.asphalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorFallback: {
    flex: 1,
    backgroundColor: COLORS.asphalt,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorFallbackText: {
    color: COLORS.ink,
    fontSize: 18,
    marginBottom: 24,
  },
  restartBtn: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 28,
    minHeight: 44,
    justifyContent: 'center',
  },
  // accentInk on accent — white-on-accent is 2:1 and banned by the spec
  restartBtnText: {
    color: COLORS.accentInk,
    fontSize: 16,
    fontWeight: '600',
  },
});
