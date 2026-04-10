import React, { useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

import MapScreen from './src/screens/MapScreen';
import SearchSheet from './src/components/SearchSheet';
import CreateScreen from './src/screens/CreateScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const { width: SCREEN_W } = Dimensions.get('window');

const SPRING = { damping: 40, stiffness: 200, mass: 1 };

// Track layout:  [ Create | Map+Sheet | Profile ]
// slideX = 0           → create
// slideX = -SCREEN_W   → map (default)
// slideX = -SCREEN_W*2 → profile
export default function Scene({ user, onSignOut }) {
  const [viewport, setViewport] = useState(null);

  const slideX = useSharedValue(-SCREEN_W);
  const startX = useSharedValue(0);

  function makeEdgePan(onlyDirection) {
    const offsetX = onlyDirection === 'left' ? [-99999, -15] : [15, 99999];
    return Gesture.Pan()
      .activeOffsetX(offsetX)
      .failOffsetY([-20, 20])
      .onBegin(() => { startX.value = slideX.value; })
      .onUpdate((e) => {
        const next = startX.value + e.translationX;
        slideX.value = Math.max(-SCREEN_W * 2, Math.min(0, next));
      })
      .onEnd((e) => {
        const pages = [0, -SCREEN_W, -SCREEN_W * 2];
        const projected = slideX.value + e.velocityX * 0.18;
        const closest = pages.reduce((a, b) =>
          Math.abs(a - projected) < Math.abs(b - projected) ? a : b
        );
        slideX.value = withSpring(closest, SPRING);
      });
  }

  const panBackFromCreate  = makeEdgePan('left');
  const panBackFromProfile = makeEdgePan('right');

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.track, trackStyle]}>

        {/* page 0 — create */}
        <GestureDetector gesture={panBackFromCreate}>
          <View style={[styles.page, styles.darkPage]}>
            <CreateScreen
              viewport={viewport}
              onCreated={() => { slideX.value = withSpring(-SCREEN_W, SPRING); }}
            />
          </View>
        </GestureDetector>

        {/* page 1 — map + search sheet */}
        <View style={styles.page}>
          <MapScreen onRegionChangeComplete={setViewport} />
          <SearchSheet slideX={slideX} screenW={SCREEN_W} viewport={viewport} />
        </View>

        {/* page 2 — profile */}
        <GestureDetector gesture={panBackFromProfile}>
          <View style={[styles.page, styles.darkPage]}>
            <ProfileScreen user={user} onSignOut={onSignOut} />
          </View>
        </GestureDetector>

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a', overflow: 'hidden' },
  track: {
    flex: 1,
    flexDirection: 'row',
    width: SCREEN_W * 3,
  },
  page: { width: SCREEN_W, flex: 1 },
  darkPage: { backgroundColor: '#0a0a0a' },
});
