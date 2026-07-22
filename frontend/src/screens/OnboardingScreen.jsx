import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, AccessibilityInfo, Animated,
} from 'react-native';
import { COLORS } from '../constants/colors';

// The word cycles through the device's own faces — no font assets to load.
// All of these ship with iOS; on other platforms unknown names fall back to
// the system font, which just reads as extra frames of the same glitch.
const FONTS = [
  'Avenir Next',
  'American Typewriter',
  'Baskerville',
  'Bodoni 72',
  'Chalkboard SE',
  'Cochin',
  'Copperplate',
  'Courier New',
  'Didot',
  'Futura',
  'Georgia',
  'Gill Sans',
  'Helvetica Neue',
  'Hoefler Text',
  'Marker Felt',
  'Menlo',
  'Noteworthy',
  'Optima',
  'Palatino',
  'Rockwell',
  'Snell Roundhand',
  'Times New Roman',
  'Trebuchet MS',
  'Zapfino',
];

// Glitch cadence: mostly rapid slips, occasionally the signal "locks" and
// holds a face for a beat before slipping again.
const SLIP_MIN_MS = 55;
const SLIP_MAX_MS = 140;
const HOLD_MS = 520;
const HOLD_CHANCE = 0.14;
const FLASH_CHANCE = 0.16; // frames that flash accent instead of ink
const REDUCED_SWAP_MS = 1600;

function nextIndex(current) {
  let i = current;
  while (i === current) i = Math.floor(Math.random() * FONTS.length);
  return i;
}

export default function OnboardingScreen({ onDone }) {
  const [fontIndex, setFontIndex] = useState(0);
  const [flash, setFlash] = useState(false);
  const [jitter, setJitter] = useState({ x: 0, y: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    function tick() {
      setFontIndex((i) => nextIndex(i));
      if (reduceMotion) {
        setFlash(false);
        setJitter({ x: 0, y: 0 });
        timerRef.current = setTimeout(tick, REDUCED_SWAP_MS);
        return;
      }
      setFlash(Math.random() < FLASH_CHANCE);
      setJitter({
        x: Math.round((Math.random() - 0.5) * 6),
        y: Math.round((Math.random() - 0.5) * 6),
      });
      const hold = Math.random() < HOLD_CHANCE;
      const delay = hold
        ? HOLD_MS
        : SLIP_MIN_MS + Math.random() * (SLIP_MAX_MS - SLIP_MIN_MS);
      timerRef.current = setTimeout(tick, delay);
    }
    tick();
    return () => clearTimeout(timerRef.current);
  }, [reduceMotion]);

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(hintOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, 1800);
    return () => clearTimeout(t);
  }, [hintOpacity]);

  return (
    <Pressable
      style={styles.root}
      onPress={onDone}
      accessibilityRole="button"
      accessibilityLabel="scene — tap to get in"
    >
      <View style={styles.wordBox} accessibilityElementsHidden>
        <Text
          style={[
            styles.word,
            {
              fontFamily: FONTS[fontIndex],
              color: flash ? COLORS.accent : COLORS.ink,
              transform: [{ translateX: jitter.x }, { translateY: jitter.y }],
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          scene
        </Text>
      </View>
      <Animated.Text style={[styles.hint, { opacity: hintOpacity }]}>
        tap anywhere
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed box so the word swaps in place; faces differ wildly in metrics and
  // adjustsFontSizeToFit needs hard bounds to keep Zapfino-class faces inside.
  wordBox: {
    height: 120,
    alignSelf: 'stretch',
    marginHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    fontSize: 56,
    textAlign: 'center',
  },
  hint: {
    position: 'absolute',
    bottom: 72,
    color: COLORS.inkSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
