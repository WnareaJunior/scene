import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthScreen from './AuthScreen';
import Scene from './Scene';
import { users, saveTokens } from './src/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);
  
  async function bootstrap() {
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (token) {
        const me = await users.me();
        if (me && me.id) {
          setUser(me);
        } else {
          await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
        }
      }
    } catch {
      await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
    } finally {
      setLoading(false);
    }
  }

  function handleAuth(data) {
    saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {user ? (
          <Scene user={user} onSignOut={handleSignOut} />
        ) : (
          <AuthScreen onAuth={handleAuth} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
