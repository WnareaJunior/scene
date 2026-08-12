// Web shell — Metro resolves this instead of Scene.jsx on web. The native
// Scene is a gesture-driven swipe track around a map; none of that survives
// the platform (react-native-maps has no web target), so web v1 is a centered
// column with two surfaces: the read-only feed and the profile.
// Routing: /feed and /profile via urlSync; App.js owns the auth guard.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from './src/constants/colors';
import { getPath, pushPath, onPathChange } from './src/urlSync';
import WebFeed from './src/web/WebFeed';
import WebProfile from './src/web/WebProfile';

export default function Scene({ user, onSignOut }) {
  const [path, setPath] = useState(getPath());

  useEffect(() => onPathChange(setPath), []);

  const page = path === '/profile' ? 'profile' : 'feed';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.logo}>scene</Text>
          <View style={styles.nav}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => pushPath('/feed')}
              testID="nav-feed"
              accessibilityRole="button"
              accessibilityLabel="feed"
            >
              <Text style={[styles.navText, page === 'feed' && styles.navTextActive]}>feed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => pushPath('/profile')}
              testID="nav-profile"
              accessibilityRole="button"
              accessibilityLabel="your profile"
            >
              <Text style={[styles.navText, page === 'profile' && styles.navTextActive]}>
                {user?.username ? `@${user.username}` : 'profile'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        {page === 'feed' ? (
          <WebFeed />
        ) : (
          <WebProfile user={user} onSignOut={onSignOut} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.asphalt },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  logo: { color: COLORS.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  nav: { flexDirection: 'row', gap: 4 },
  navBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  navText: { color: COLORS.inkSecondary, fontSize: 15, fontWeight: '600' },
  navTextActive: { color: COLORS.accent },
});
