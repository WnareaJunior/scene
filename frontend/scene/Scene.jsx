import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Platform,
  KeyboardAvoidingView, Dimensions,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, withSpring, runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import MapScreen from './src/screens/MapScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CreateScreen from './src/screens/CreateScreen';

const { width: SCREEN_W } = Dimensions.get('window');

export default function Scene({ user, onSignOut }) {
  const [screen, setScreen] = useState('map'); // 'map' | 'profile' | 'create'
  const [viewport, setViewport] = useState(null);

  // ── Swipe navigation gesture ────────────────────────────────────────────────

  const navGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .onEnd((e) => {
      const THRESHOLD = 60;
      if (e.translationX > THRESHOLD) {
        runOnJS(setScreen)('profile');
      } else if (e.translationX < -THRESHOLD) {
        runOnJS(setScreen)('create');
      } else {
        runOnJS(setScreen)('map');
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ translateX: withSpring(
      screen === 'profile' ? SCREEN_W : screen === 'create' ? -SCREEN_W : 0,
      { damping: 20 },
    )}],
  }));

  return (
    <View style={styles.root}>
      {/* Nav hints live outside the sliding view so they stay visible during swipe nav */}
      <SafeAreaView style={styles.navHints} pointerEvents="none">
        <Text style={styles.navHint}>👤</Text>
        <Text style={styles.appTitle}>scene</Text>
        <Text style={styles.navHint}>＋</Text>
      </SafeAreaView>

      <Animated.View style={[StyleSheet.absoluteFill, containerStyle]}>
        {/* ── MAP ──────────────────────────────────── */}
        <MapScreen
          navGesture={navGesture}
          viewport={viewport}
          onViewportChange={setViewport}
        />

        {/* ── PROFILE ──────────────────────────────── */}
        <View style={[styles.sideScreen, { left: -SCREEN_W }]}>
          <ProfileScreen user={user} onSignOut={onSignOut} />
        </View>

        {/* ── CREATE ───────────────────────────────── */}
        <KeyboardAvoidingView
          style={[styles.sideScreen, { left: SCREEN_W }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <CreateScreen viewport={viewport} onCreated={() => setScreen('map')} />
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', overflow: 'hidden' },
  navHints: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  navHint: { color: 'rgba(255,255,255,0.5)', fontSize: 20 },
  appTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  sideScreen: {
    position: 'absolute', top: 0, bottom: 0, width: SCREEN_W,
    backgroundColor: '#0a0a0a',
  },
});
