import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Dimensions, Keyboard } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
  useAnimatedReaction, runOnJS, ReduceMotion,
} from 'react-native-reanimated';

import MapScreen from './src/screens/MapScreen';
import SearchSheet from './src/components/SearchSheet';
import CreateScreen from './src/screens/CreateScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const { width: SCREEN_W } = Dimensions.get('window');

// Lively, velocity-aware settle — overdamped springs read as "rigid".
// ReduceMotion.Never: these springs settle a gesture's position, not decoration;
// under the system Reduce Motion setting Reanimated would complete them in one
// frame, so releases teleport instead of glide.
const SPRING = { damping: 34, stiffness: 280, mass: 0.9, reduceMotion: ReduceMotion.Never };
// Drag resistance past the first/last page — rubber band, not a wall.
const OVERDRAG = 0.15;

// Track layout:  [ Create | Map+Sheet | Profile ]
// slideX = 0           → create
// slideX = -SCREEN_W   → map (default)
// slideX = -SCREEN_W*2 → profile
export default function Scene({ user, onSignOut }) {
  const [viewport, setViewport] = useState(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  // Lazy-mount: only render a page once first visited. Map starts visited.
  const [visited, setVisited] = useState({ create: false, map: true, profile: false });

  const slideX = useSharedValue(-SCREEN_W);
  const startX = useSharedValue(0);

  const markVisited = useCallback((page) => {
    setVisited((v) => (v[page] ? v : { ...v, [page]: true }));
  }, []);

  useAnimatedReaction(
    () => slideX.value,
    (val) => {
      if (val === 0) runOnJS(markVisited)('create');
      else if (val === -SCREEN_W) runOnJS(markVisited)('map');
      else if (val === -SCREEN_W * 2) runOnJS(markVisited)('profile');
    },
  );

  const onNavigate = useCallback((page, velocity = 0) => {
    Keyboard.dismiss();
    const targets = { create: 0, map: -SCREEN_W, profile: -SCREEN_W * 2 };
    if (targets[page] !== undefined) {
      // Mount the destination before the glide starts — waiting for the settle
      // reaction slides a blank page over and pops the content in at the end.
      markVisited(page);
      slideX.value = withSpring(targets[page], { ...SPRING, velocity });
    }
  }, [slideX, markVisited]);

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  function makeEdgePan(onlyDirection) {
    // Single-sided threshold: a [-99999, -15]-style range leaves no inactive
    // band around 0, so the pan activated on any touch movement in the edge
    // strip and swallowed taps and vertical scrolls there.
    const offsetX = onlyDirection === 'left' ? -15 : 15;
    return Gesture.Pan()
      .activeOffsetX(offsetX)
      .failOffsetY([-20, 20])
      .onBegin(() => {
        startX.value = slideX.value;
        runOnJS(dismissKeyboard)();
      })
      .onUpdate((e) => {
        const lo = onlyDirection === 'left'
          ? Math.max(-SCREEN_W * 2, startX.value - SCREEN_W)
          : startX.value;
        const hi = onlyDirection === 'left'
          ? startX.value
          : Math.min(0, startX.value + SCREEN_W);
        const next = startX.value + e.translationX;
        const clamped = Math.max(lo, Math.min(hi, next));
        slideX.value = clamped + (next - clamped) * OVERDRAG;
      })
      .onEnd((e) => {
        const didSwipe = Math.abs(e.translationX) > SCREEN_W * 0.25 || Math.abs(e.velocityX) > 300;
        if (didSwipe) {
          const dir = onlyDirection === 'left' ? -1 : 1;
          const target = Math.max(-SCREEN_W * 2, Math.min(0, startX.value + dir * SCREEN_W));
          slideX.value = withSpring(target, { ...SPRING, velocity: e.velocityX });
        } else {
          slideX.value = withSpring(startX.value, { ...SPRING, velocity: e.velocityX });
        }
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
        <View style={[styles.page, styles.darkPage]}>
          {visited.create && (
            <CreateScreen
              viewport={viewport}
              onCreated={() => {
                onNavigate('map');
                setProfileRefreshKey((k) => k + 1);
              }}
            />
          )}
          <GestureDetector gesture={panBackFromCreate}>
            <View style={styles.rightEdge} />
          </GestureDetector>
        </View>

        {/* page 1 — map + search sheet */}
        <View style={styles.page}>
          {visited.map && (
            <>
              <MapScreen onRegionChangeComplete={setViewport} />
              <SearchSheet
                slideX={slideX}
                screenW={SCREEN_W}
                viewport={viewport}
                onNavigate={onNavigate}
              />
            </>
          )}
        </View>

        {/* page 2 — profile */}
        <View style={[styles.page, styles.darkPage]}>
          {visited.profile && (
            <ProfileScreen user={user} onSignOut={onSignOut} refreshKey={profileRefreshKey} />
          )}
          <GestureDetector gesture={panBackFromProfile}>
            <View style={styles.leftEdge} />
          </GestureDetector>
        </View>

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
  rightEdge: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
  },
  leftEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 28,
  },
});
