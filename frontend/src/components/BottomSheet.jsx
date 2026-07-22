import React, { useCallback } from 'react';
import { Modal, TouchableOpacity, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, ReduceMotion,
} from 'react-native-reanimated';
import { COLORS } from '../constants/colors';

// Gesture-settling springs opt out of system Reduce Motion — a 0-frame jump on
// a finger-driven surface is a bug, not an accessibility win (see Scene.jsx).
const SPRING = { damping: 32, stiffness: 260, mass: 0.9, reduceMotion: ReduceMotion.Never };

// The one modal sheet: scrim + 20px top radius + draggable handle zone.
// Drag-to-dismiss lives on the handle zone only, so it never has to arbitrate
// with a scrolling FlatList in the body (the SearchSheet pattern).
export default function BottomSheet({ visible, onClose, maxHeight = '85%', children }) {
  const dragY = useSharedValue(0);

  const finishClose = useCallback(() => {
    onClose();
    dragY.value = 0;
  }, [onClose, dragY]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) dragY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        dragY.value = withTiming(900, { duration: 180, reduceMotion: ReduceMotion.Never }, () => {
          runOnJS(finishClose)();
        });
      } else {
        dragY.value = withSpring(0, { ...SPRING, velocity: e.velocityY });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="close"
        />
        <Animated.View style={[styles.sheet, { maxHeight }, sheetStyle]}>
          <GestureDetector gesture={pan}>
            <View style={styles.handleZone}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.scrim },
  sheet: {
    backgroundColor: COLORS.asphalt,
    overflow: 'hidden',
  },
  handleZone: { paddingVertical: 12, alignItems: 'center' },
  handle: { width: 40, height: 5, backgroundColor: COLORS.handle },
});
