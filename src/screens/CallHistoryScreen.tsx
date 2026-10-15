import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { db } from '@/services/firebase';
import { useAuthStore } from '@/store/authStore';
import { useUsers } from '@/store/userCache';
import { palette, spacing, fontSize } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { startCall, acceptCall, declineCall } from '@/services/calls';
import { formatChatTimestamp } from '@/utils/time';
import { scope } from '@/utils/logger';
import type { CallKind, CallSession } from '@/types/extended';
import type { TabScreenProps } from '@/navigation/types';

const log = scope('CallHistoryScreen');

/**
 * Calls tab: recent call sessions, newest first, with tap-to-call-back.
 * Sessions come from the `calls` collection (signalling only — media is
 * handled by the Call screen once joined).
 */
export function CallHistoryScreen({ navigation }: TabScreenProps<'Calls'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return db
      .collection('calls')
      .where('participantIds', 'array-contains', uid)
      .orderBy('startedAt', 'desc')
      .limit(50)
      .onSnapshot(
        (snap) => {
          if (!snap) return;
          setCalls(snap.docs.map((d) => d.data() as CallSession));
        },
        (e) => {
          log.warn('calls feed failed', e);
          setError((e as Error).message);
        },
      );
  }, [uid]);

  const peerIds = calls.map((c) => c.participantIds.find((p) => p !== uid) ?? c.initiatorId);
  const profiles = useUsers([...new Set(peerIds)]);

  const callBack = async (call: CallSession, kind: CallKind) => {
    if (!uid) return;
    try {
      const id = await startCall(call.chatId, kind, uid, call.participantIds);
      // Tabs live inside the app stack — reach up one level for the Call screen.
      navigation.getParent()?.navigate('Call' as never, { callId: id } as never);
    } catch (e) {
      log.warn('call back failed', e);
    }
  };

  const incoming = calls.find((c) => c.state === 'ringing' && c.initiatorId !== uid);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (calls.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="No calls yet"
          message="Your recent voice and video calls will appear here."
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {incoming ? (
        <View style={styles.incoming}>
          <Text style={styles.incomingTitle}>Incoming {incoming.kind} call</Text>
          <Text style={styles.incomingSub}>
            {profiles[incoming.initiatorId]?.displayName ||
              profiles[incoming.initiatorId]?.username ||
              'Unknown'}
          </Text>
          <View style={styles.incomingActions}>
            <Pressable
              style={[styles.incomingButton, styles.decline]}
              onPress={() => uid && void declineCall(incoming.id, uid).catch(() => undefined)}
              accessibilityRole="button"
              accessibilityLabel="Decline call"
            >
              <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
            <Pressable
              style={[styles.incomingButton, styles.accept]}
              onPress={() => {
                if (!uid) return;
                void acceptCall(incoming.id, uid)
                  .then(() =>
                    navigation.getParent()?.navigate('Call' as never, { callId: incoming.id } as never),
                  )
                  .catch(() => undefined);
              }}
              accessibilityRole="button"
              accessibilityLabel="Answer call"
            >
              <Ionicons name="call" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}
      <FlatList
        data={calls}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const peerId = item.participantIds.find((p) => p !== uid) ?? item.initiatorId;
          const name = profiles[peerId]?.displayName || profiles[peerId]?.username || 'Unknown';
          const missed = item.state === 'missed' || (item.state === 'declined' && item.initiatorId !== uid);
          return (
            <View style={styles.row}>
              <Avatar name={name} photoURL={profiles[peerId]?.photoURL ?? null} seed={peerId} />
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[styles.sub, missed && styles.missed]} numberOfLines={1}>
                  {item.state === 'ringing' ? 'Ringing…' : `${item.kind === 'video' ? 'Video' : 'Voice'} · ${formatChatTimestamp(item.startedAt)}`}
                </Text>
              </View>
              <Pressable
                style={styles.callButton}
                onPress={() => void callBack(item, 'voice')}
                accessibilityRole="button"
                accessibilityLabel={`Voice call ${name}`}
              >
                <Ionicons name="call-outline" size={22} color={palette.accent} />
              </Pressable>
              <Pressable
                style={styles.callButton}
                onPress={() => void callBack(item, 'video')}
                accessibilityRole="button"
                accessibilityLabel={`Video call ${name}`}
              >
                <Ionicons name="videocam-outline" size={24} color={palette.accent} />
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  error: { color: palette.danger, fontSize: fontSize.sm, textAlign: 'center' },
  list: { paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: { flex: 1, marginLeft: spacing.md },
  name: { color: palette.text, fontSize: fontSize.md, fontWeight: '600' },
  sub: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  missed: { color: palette.danger },
  callButton: { padding: spacing.sm },
  incoming: {
    backgroundColor: palette.surface,
    margin: spacing.md,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.accent,
  },
  incomingTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: '700' },
  incomingSub: { color: palette.textMuted, fontSize: fontSize.md, marginTop: 4 },
  incomingActions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  incomingButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accept: { backgroundColor: '#2E9E5B' },
  decline: { backgroundColor: palette.danger },
});
