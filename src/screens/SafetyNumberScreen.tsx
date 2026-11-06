import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { Button } from '@/components/Button';
import { getCrypto } from '@/services/crypto';
import { useIdentityAlertStore } from '@/store/identityAlertStore';
import type { AppStackParamList } from '@/navigation/types';

interface Props {
  route: { params: { peerId: string; name?: string } };
}

/**
 * The safety number.
 *
 * A fingerprint of both people's identity keys, computed identically on each
 * side, so the two can be read out and compared. It is the only thing in the app
 * that lets a user check the encryption claim for themselves rather than taking
 * it on trust.
 *
 * The number is derived from keys this device already holds; it is never sent
 * anywhere.
 */
export function SafetyNumberScreen({ route }: Props): React.JSX.Element {
  const { peerId, name } = route.params;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const dismissAlert = useIdentityAlertStore((s) => s.dismiss);
  const [confirmed, setConfirmed] = useState(false);

  // `safetyNumberWithPeer` throws when there is no session yet, which is the
  // normal state for someone you have never exchanged a message with.
  const number = useMemo(() => {
    try {
      return getCrypto().safetyNumberWithPeer(peerId);
    } catch {
      return null;
    }
  }, [peerId]);

  const who = name ?? 'this contact';
  // Eight groups of five, laid out two per line so it is readable and callable.
  const lines = number ? (number.split(' ').join('').match(/.{1,10}/g) ?? []) : [];

  const onConfirm = (): void => {
    void dismissAlert(peerId);
    setConfirmed(true);
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Safety number</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {number ? (
          <>
            <View style={styles.codeCard}>
              {lines.map((line, i) => (
                <Text key={i} style={styles.code}>
                  {line.match(/.{1,5}/g)?.join(' ')}
                </Text>
              ))}
            </View>

            <Text style={styles.explain}>
              This is a fingerprint of your key and {who}'s, computed on both phones. If the two
              match, nobody is sitting between you — not the server, not the network.
            </Text>
            <Text style={styles.explain}>
              Compare it in person, or read it aloud over a call. Do not send it as a message: if
              someone is intercepting you, they see the messages too.
            </Text>

            {confirmed ? (
              <View style={styles.confirmed}>
                <Ionicons name="checkmark-circle" size={18} color={palette.success} />
                <Text style={styles.confirmedText}>Recorded. The warning in this chat is cleared.</Text>
              </View>
            ) : (
              <Button label="We compared it" onPress={onConfirm} fullWidth />
            )}
          </>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="lock-open-outline" size={40} color={palette.textMuted} />
            <Text style={styles.emptyTitle}>No secure session yet</Text>
            <Text style={styles.explain}>
              A safety number only exists once you and {who} have exchanged a message. Send one, then
              come back.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.backgroundSolid },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  headerSpacer: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  codeCard: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  // Monospace and wide-tracked: this gets read aloud, so the grouping has to be
  // unambiguous at a glance.
  code: {
    color: palette.text,
    fontSize: fontSize.lg,
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  explain: { color: palette.textMuted, fontSize: fontSize.sm, lineHeight: 20 },
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  confirmedText: { color: palette.text, fontSize: fontSize.sm, flex: 1 },
  empty: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  emptyTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
