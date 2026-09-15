import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { events as eventsApi } from '../api';
import { COLORS } from '../constants/colors';

const PAGE = 30;
const MAX_BODY = 500;

function timeAgo(iso) {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * The comment thread on an event sheet.
 *
 * Posting needs an RSVP (the host is exempt) and the server enforces it. The
 * client mirrors that rule to decide whether to show the composer at all,
 * rather than letting someone type a comment only to be refused on send.
 *
 * Reads are oldest-first, so a thread reads forward like a conversation.
 */
export default function CommentThread({ eventId, canPost, isHost, onUserPress }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    try {
      // The endpoint pages newest-first and reverses, so one page with no
      // offset is the tail of the conversation in chronological order.
      const res = await eventsApi.comments(eventId, { limit: PAGE });
      if (req !== reqRef.current) return;
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
      setFailed(false);
    } catch {
      if (req === reqRef.current) setFailed(true);
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setRows([]);
    setDraft('');
    load();
  }, [eventId, load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await eventsApi.comment(eventId, body);
      setRows((prev) => [...prev, created]);
      setTotal((n) => n + 1);
      setDraft('');
    } catch (err) {
      Alert.alert(
        "couldn't post that",
        err?.status === 403
          ? 'rsvp to the party first.'
          : 'check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = (comment) => {
    Alert.alert('delete this comment?', 'no undo.', [
      { text: 'keep it', style: 'cancel' },
      {
        text: 'delete',
        style: 'destructive',
        onPress: async () => {
          const before = rows;
          setRows((prev) => prev.filter((c) => c.id !== comment.id));
          setTotal((n) => Math.max(0, n - 1));
          try {
            await eventsApi.deleteComment(eventId, comment.id);
          } catch {
            setRows(before);          // put it back; the delete did not land
            setTotal(before.length);
            Alert.alert("couldn't delete that", 'check your connection and try again.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.block}>
        <ActivityIndicator size="small" color={COLORS.inkFaint} />
      </View>
    );
  }

  // A thread that failed to load stays quiet rather than shouting an error
  // into the middle of the sheet.
  if (failed) return null;

  const hidden = total - rows.length;

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>
        {total === 0 ? 'comments' : `comments · ${total}`}
      </Text>

      {hidden > 0 && (
        <Text style={styles.earlier}>{hidden} earlier hidden</Text>
      )}

      {rows.length === 0 && (
        <Text style={styles.empty}>
          {canPost ? 'say something' : 'no comments yet'}
        </Text>
      )}

      {rows.map((c) => (
        <View key={c.id} style={styles.row}>
          <TouchableOpacity
            onPress={() => onUserPress?.(c.user_id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`@${c.username}, view profile`}
          >
            {c.profile_picture ? (
              <Image source={{ uri: c.profile_picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>
                  {c.username?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.bubble}>
            <View style={styles.bubbleHead}>
              <Text style={styles.name} numberOfLines={1}>@{c.username}</Text>
              {c.is_host && <Text style={styles.hostTag}>host</Text>}
              <Text style={styles.when}>{timeAgo(c.created_at)}</Text>
            </View>
            <Text style={styles.body}>{c.body}</Text>
          </View>

          {/* c.is_host flags the author, not the viewer — the host's power to
              moderate comes from isHost, which the sheet already computes. */}
          {(c.is_mine || isHost) && (
            <TouchableOpacity
              onPress={() => remove(c)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`delete comment by ${c.username}`}
            >
              <Text style={styles.delete}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {canPost ? (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="say something"
            placeholderTextColor={COLORS.inkSecondary}
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_BODY}
            multiline
            accessibilityLabel="write a comment"
          />
          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || busy}
            style={[styles.send, (!draft.trim() || busy) && styles.sendOff]}
            accessibilityRole="button"
            accessibilityLabel="post comment"
          >
            <Text style={[styles.sendText, (!draft.trim() || busy) && styles.sendTextOff]}>
              {busy ? '…' : 'post'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.locked}>rsvp to join the conversation</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 16, marginHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: COLORS.divider,
  },
  heading: { color: COLORS.inkSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  earlier: { color: COLORS.inkFaint, fontSize: 12, marginBottom: 8 },
  empty: { color: COLORS.inkSecondary, fontSize: 13, marginBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  avatar: { width: 28, height: 28, backgroundColor: COLORS.card },
  avatarPlaceholder: {
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.inkSecondary, fontSize: 12, fontWeight: '700' },

  bubble: { flex: 1 },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: COLORS.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  hostTag: {
    color: COLORS.accent, fontSize: 10, fontWeight: '700',
    borderWidth: 1, borderColor: COLORS.accent,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  when: { color: COLORS.inkFaint, fontSize: 11 },
  body: { color: COLORS.ink, fontSize: 14, lineHeight: 20, marginTop: 2 },
  delete: { color: COLORS.inkFaint, fontSize: 18, paddingHorizontal: 2 },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12,
    color: COLORS.ink, fontSize: 14,
  },
  send: {
    minHeight: 44, paddingHorizontal: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  sendText: { color: COLORS.accentInk, fontSize: 14, fontWeight: '700' },
  sendTextOff: { color: COLORS.inkSecondary },

  locked: { color: COLORS.inkSecondary, fontSize: 13, marginTop: 4, marginBottom: 4 },
});
