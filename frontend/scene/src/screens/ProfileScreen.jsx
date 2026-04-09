import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { users, auth, clearTokens } from '../api';

export default function ProfileScreen({ user, onSignOut }) {
  const [profileData, setProfileData] = useState(user);

  useEffect(() => {
    users.me().then((d) => { if (d?.id) setProfileData(d); }).catch(() => {});
  }, []);

  async function handleSignOut() {
    await auth.logout();
    await clearTokens();
    onSignOut();
  }

  return (
    <SafeAreaView style={styles.safeContent}>
      <Text style={styles.screenTitle}>profile</Text>
      <View style={styles.profileCard}>
        <Text style={styles.profileName}>{profileData?.username}</Text>
        <Text style={styles.profileEmail}>{profileData?.email}</Text>
        {profileData?.bio ? <Text style={styles.profileBio}>{profileData.bio}</Text> : null}
        <View style={styles.profileStats}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profileData?.followers_count ?? 0}</Text>
            <Text style={styles.statLabel}>followers</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{profileData?.following_count ?? 0}</Text>
            <Text style={styles.statLabel}>following</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContent: { flex: 1, paddingHorizontal: 24 },
  screenTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20, marginTop: 16 },
  profileCard: {
    backgroundColor: '#1a1a1a', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#2a2a2a',
  },
  profileName: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  profileEmail: { color: '#666', fontSize: 14, marginBottom: 10 },
  profileBio: { color: '#aaa', fontSize: 15, marginBottom: 16 },
  profileStats: { flexDirection: 'row', gap: 24 },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statLabel: { color: '#555', fontSize: 12 },
  signOutBtn: {
    marginTop: 20, backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  signOutText: { color: '#ef4444', fontWeight: '600' },
});
