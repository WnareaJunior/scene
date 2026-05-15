import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthScreen from './AuthScreen';
import Scene from './Scene';
import { users, saveTokens, getStoredToken, clearTokens } from './src/api';

class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorFallback}>
          <Text style={styles.errorFallbackText}>Something went wrong</Text>
          <TouchableOpacity
            style={styles.restartBtn}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={styles.restartBtnText}>Restart</Text>
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

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
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
      await clearTokens();
    } finally {
      setLoading(false);
    }
  }

  async function handleAuth(data) {
    await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setUser(data.user);
  }

  function handleSignOut() {
    setUser(null);
  }

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {user ? (
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
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorFallback: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorFallbackText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 24,
  },
  restartBtn: {
    backgroundColor: '#a855f7',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  restartBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
