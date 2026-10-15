import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useUsers } from '@/store/userCache';
import { subscribeCall } from '@/services/calls';
import { CallScreen } from './CallScreen';
import type { CallSession } from '@/types/extended';
import type { AppScreenProps } from '@/navigation/types';

/**
 * Wraps CallScreen with the app's stores: subscribes to the call session,
 * resolves participant profiles, and renders the room.
 *
 * The `renderRoom` prop is where the LiveKit room goes once
 * `@livekit/react-native` is added (see ROADMAP.md Phase 3). Until then the
 * call UI shows signalling state (ringing/active/ended) with a placeholder
 * where the media tiles will live.
 */
export function CallHost({ route, navigation }: AppScreenProps<'Call'>): React.JSX.Element {
  const { callId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const [session, setSession] = useState<CallSession | null>(null);

  useEffect(() => subscribeCall(callId, setSession), [callId]);
  const profiles = useUsers(session?.participantIds ?? []);

  return (
    <CallScreen
      callId={callId}
      myUid={uid ?? ''}
      profiles={profiles}
      renderRoom={(_session: CallSession) => <RoomPlaceholder />}
      onHangUp={() => navigation.goBack()}
    />
  );
}

function RoomPlaceholder(): React.JSX.Element {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>🎥</Text>
      <Text style={styles.sub}>Video tiles appear here once LiveKit is wired up.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  text: { fontSize: 64 },
  sub: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: spacing.md, textAlign: 'center' },
});
