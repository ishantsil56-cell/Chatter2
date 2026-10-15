import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { subscribeCall, endCall } from '@/services/calls';
import type { CallSession } from '@/types/extended';
import type { UserId, UserProfile } from '@/types';

export interface CallScreenProps {
  callId: string;
  myUid: UserId;
  profiles: Record<UserId, UserProfile>;
  /** LiveKit room component rendered once the call is active. */
  renderRoom: (session: CallSession) => React.JSX.Element;
  onHangUp: () => void;
}

/**
 * Full-screen call UI. Signalling state comes from Firestore (`calls/{id}`);
 * media itself is rendered by the host app's LiveKit room component.
 *
 * States mirror WhatsApp: ringing (with accept/decline for callee), active
 * (room + controls), ended (auto-dismiss).
 */
export function CallScreen({ callId, myUid, profiles, renderRoom, onHangUp }: CallScreenProps): React.JSX.Element {
  const [session, setSession] = useState<CallSession | null>(null);

  useEffect(() => subscribeCall(callId, setSession), [callId]);
  useEffect(() => {
    if (session && (session.state === 'ended' || session.state === 'declined' || session.state === 'missed')) {
      const t = setTimeout(onHangUp, 1200);
      return () => clearTimeout(t);
    }
  }, [session, onHangUp]);

  if (!session) {
    return (
      <View style={styles.root}>
        <Text style={styles.status}>Connecting…</Text>
      </View>
    );
  }

  const peerId = session.participantIds.find((p) => p !== myUid) ?? session.initiatorId;
  const peer = profiles[peerId];
  const name = peer?.displayName || peer?.username || 'Unknown';
  const isCaller = session.initiatorId === myUid;

  if (session.state === 'ringing' && !isCaller) {
    return (
      <View style={styles.root}>
        <Avatar name={name} photoURL={peer?.photoURL ?? null} seed={peerId} />
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.status}>
          Incoming {session.kind} call…
        </Text>
        <Text style={styles.secure}>🔒 End-to-end encrypted</Text>
        {/* Accept/decline are wired by the host via acceptCall/declineCall */}
      </View>
    );
  }

  if (session.state === 'active') {
    return (
      <View style={styles.root}>
        {renderRoom(session)}
        <Pressable
          style={styles.hangUp}
          onPress={() => {
            void endCall(callId, myUid);
            onHangUp();
          }}
          accessibilityRole="button"
          accessibilityLabel="End call"
        >
          <Text style={styles.hangUpGlyph}>📞</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.status}>
        {session.state === 'missed' ? 'Missed call' : session.state === 'declined' ? 'Declined' : 'Call ended'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.backgroundSolid,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  name: { fontSize: fontSize.xl, color: palette.text, fontWeight: '600', marginTop: spacing.md },
  status: { fontSize: fontSize.md, color: palette.textMuted, marginTop: spacing.sm },
  secure: { fontSize: fontSize.sm, color: palette.success, marginTop: spacing.md },
  hangUp: {
    position: 'absolute',
    bottom: spacing.xxl,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hangUpGlyph: { fontSize: 28, transform: [{ rotate: '135deg' }] },
});
