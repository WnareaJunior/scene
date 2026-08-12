// Web v1 profile — view own profile and edit the bio. Native never imports
// this file. Scope notes vs the native ProfileScreen:
//   - avatar upload: native-only (expo-image-picker), hidden here
//   - username: immutable server-side (PATCH /users/me has no username field),
//     so "edit display name" maps to editing the bio
//   - account deletion, follower lists: use the app
// Sign-out is a plain button (no Alert confirm — Alert is a no-op on web).
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView,
} from 'react-native';
import { users, auth } from '../api';
import { COLORS } from '../constants/colors';

export default function WebProfile({ user, onSignOut }) {
  const [profile, setProfile] = useState(user);
  const [bioDraft, setBioDraft] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    users.me()
      .then((d) => {
        if (cancelled || !d?.id) return;
        setProfile(d);
        setBioDraft(d.bio ?? '');
      })
      .catch(() => {
        // Non-blocking: cached login data is already on screen.
      });
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await users.update({ bio: bioDraft });
      if (updated?.id) setProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'could not save — try again.');
    } finally {
      setSaving(false);
    }
  }, [bioDraft]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await auth.logout(); // revokes the refresh token and clears storage
    } finally {
      onSignOut();
    }
  }, [onSignOut]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarInitial}>
            {profile?.username?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.name} testID="profile-username">{profile?.username}</Text>
          <Text style={styles.bio} testID="profile-bio">
            {profile?.bio ? profile.bio : 'no bio yet'}
          </Text>
          <Text style={styles.stats}>
            <Text style={styles.statNumber}>{profile?.following_count ?? 0}</Text> following
            {'   '}
            <Text style={styles.statNumber}>{profile?.followers_count ?? 0}</Text> followers
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>edit bio</Text>
      <TextInput
        style={styles.input}
        value={bioDraft}
        onChangeText={(t) => { setBioDraft(t); setSaved(false); }}
        placeholder="say something about your scenes"
        placeholderTextColor={COLORS.inkSecondary}
        multiline
        maxLength={500}
        testID="profile-bio-input"
        accessibilityLabel="bio"
      />
      {error ? <Text style={styles.error} testID="profile-error">{error}</Text> : null}
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.btnDisabled]}
        onPress={handleSave}
        disabled={saving}
        testID="profile-save"
        accessibilityRole="button"
        accessibilityLabel="save bio"
      >
        {saving ? (
          <ActivityIndicator color={COLORS.accentInk} />
        ) : (
          <Text style={styles.saveBtnText}>save</Text>
        )}
      </TouchableOpacity>
      {saved ? <Text style={styles.savedNote} testID="profile-saved">saved ✓</Text> : null}

      <View style={styles.divider} />

      <TouchableOpacity
        style={[styles.signOutBtn, signingOut && styles.btnDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
        testID="profile-signout"
        accessibilityRole="button"
        accessibilityLabel="sign out"
      >
        <Text style={styles.signOutText}>sign out</Text>
      </TouchableOpacity>
      <Text style={styles.footnote}>
        avatar changes and account deletion live in the iOS app for now.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  header: { flexDirection: 'row' },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    backgroundColor: COLORS.accentTint,
    borderWidth: 2,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.accent, fontSize: 28, fontWeight: '700' },
  headerInfo: { flex: 1, marginLeft: 14 },
  name: { color: COLORS.ink, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  bio: { color: COLORS.inkSecondary, fontSize: 14, lineHeight: 19, marginBottom: 10 },
  stats: { color: COLORS.inkSecondary, fontSize: 14 },
  statNumber: { color: COLORS.ink, fontWeight: '700' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginVertical: 20,
  },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  input: {
    backgroundColor: COLORS.card,
    color: COLORS.ink,
    padding: 14,
    fontSize: 15,
    minHeight: 88,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  error: { color: COLORS.errorRed, fontSize: 13, marginBottom: 12 },
  saveBtn: {
    backgroundColor: COLORS.accent,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: COLORS.accentInk, fontWeight: '700', fontSize: 15 },
  savedNote: { color: COLORS.accent, fontSize: 13, marginTop: 10 },
  btnDisabled: { opacity: 0.5 },
  signOutBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  signOutText: { color: COLORS.errorRed, fontWeight: '600' },
  footnote: { color: COLORS.inkFaint, fontSize: 12, marginTop: 16, textAlign: 'center' },
});
