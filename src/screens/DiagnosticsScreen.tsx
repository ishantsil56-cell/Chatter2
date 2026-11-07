import React from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { Button } from '@/components/Button';
import { useDiagStore } from '@/store/diagStore';
import { APP_VERSION, MEDIA_ENABLED, PUSH_ENABLED } from '@/config';
import { scope } from '@/utils/logger';
import type { AppStackParamList } from '@/navigation/types';

const log = scope('diagnostics');

function stamp(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * The Diagnostics Centre.
 *
 * Everything here exists because there is no other way to see what the app is
 * doing: no device logs, no crash reporter, and the user is on a phone rather
 * than at a console. So the errors the app catches are listed where they can be
 * read, copied out and sent on.
 *
 * The history is session-only and in memory. An error string can contain
 * fragments of whatever failed, and a log written to disk is a privacy question
 * this app should not have to answer.
 */
export function DiagnosticsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const errors = useDiagStore((s) => s.errors);
  const clear = useDiagStore((s) => s.clear);

  const summary = [
    `IRIS ${APP_VERSION}`,
    `platform ${Platform.OS} ${String(Platform.Version)}`,
    `media ${MEDIA_ENABLED ? 'on' : 'off'}, push ${PUSH_ENABLED ? 'on' : 'off'}`,
    '',
    errors.length === 0
      ? 'No errors recorded this session.'
      : errors
          .map((e) => `${stamp(e.at)}  ${e.context ? `[${e.context}] ` : ''}${e.message}`)
          .join('\n'),
  ].join('\n');

  const onShare = (): void => {
    void Share.share({ message: summary }).catch((e) => log.warn('could not share diagnostics', e));
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Diagnostics</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.infoCard}>
          <InfoRow label="Version" value={APP_VERSION} />
          <InfoRow label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
          <InfoRow label="Media" value={MEDIA_ENABLED ? 'enabled' : 'disabled'} />
          <InfoRow label="Push" value={PUSH_ENABLED ? 'enabled' : 'disabled'} />
        </View>

        <Text style={styles.sectionTitle}>
          {errors.length === 0 ? 'No errors' : `${errors.length} recorded this session`}
        </Text>

        {errors.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={28} color={palette.success} />
            <Text style={styles.emptyText}>
              Nothing has gone wrong this session. If something does, it will appear here with the time it
              happened.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {errors.map((e, i) => (
              <View key={`${e.at}-${i}`} style={styles.errorCard}>
                <View style={styles.errorHead}>
                  <Text style={styles.errorTime}>{stamp(e.at)}</Text>
                  {e.context ? <Text style={styles.errorContext}>{e.context}</Text> : null}
                </View>
                <Text style={styles.errorMessage} selectable>
                  {e.message}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Button label="Share this report" onPress={onShare} fullWidth />
        {errors.length > 0 ? (
          <Pressable
            onPress={clear}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Clear recorded errors"
          >
            <Text style={styles.clearText}>Clear recorded errors</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>
          The list is kept in memory only and is gone when IRIS closes. Error text can include fragments of
          what failed, so read it before you send it.
        </Text>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  infoCard: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  infoLabel: { color: palette.textMuted, fontSize: fontSize.sm },
  infoValue: { color: palette.text, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  sectionTitle: { color: palette.textMuted, fontSize: fontSize.xs, letterSpacing: 1, marginTop: spacing.sm },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  emptyText: { flex: 1, color: palette.textMuted, fontSize: fontSize.sm, lineHeight: 20 },
  list: { gap: spacing.sm },
  errorCard: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    padding: spacing.md,
    gap: 4,
  },
  errorHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorTime: { color: palette.textMuted, fontSize: fontSize.xs, fontFamily: 'monospace' },
  errorContext: { color: palette.accent, fontSize: fontSize.xs },
  errorMessage: { color: palette.text, fontSize: fontSize.sm, lineHeight: 19 },
  clear: { alignSelf: 'center', padding: spacing.sm },
  clearText: { color: palette.danger, fontSize: fontSize.sm },
  footnote: { color: palette.textMuted, fontSize: fontSize.xs, lineHeight: 16, textAlign: 'center' },
});
