import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { CHANGELOG } from '@/data/changelog';
import { openUpdate } from '@/services/updates';
import { APP_VERSION } from '@/config';
import type { AppStackParamList } from '@/navigation/types';

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What shipped, newest first.
 *
 * Every entry carries an Update button. It is not conditional on the version
 * being newer: IRIS is distributed outside any store, so "get me the current
 * build" is a reasonable thing to want at any time — to reinstall, to move to a
 * device, or because something is wrong with the copy you have.
 */
export function AnnouncementsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>{'What\u2019s new'}</Text>
          <Text style={styles.headerSub}>You are on version {APP_VERSION}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={CHANGELOG}
        keyExtractor={(item) => item.version}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.version}>{item.version}</Text>
              <Text style={styles.date}>{prettyDate(item.date)}</Text>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.items}>
              {item.items.map((line) => (
                <View key={line} style={styles.itemRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.itemText}>{line}</Text>
                </View>
              ))}
            </View>
            <Pressable
              onPress={() => void openUpdate()}
              style={({ pressed }) => [styles.updateButton, pressed && styles.updatePressed]}
              accessibilityRole="button"
              accessibilityLabel={`Update IRIS, version ${item.version}`}
            >
              <Ionicons name="arrow-down-circle-outline" size={16} color={palette.textInverse} />
              <Text style={styles.updateText}>Update</Text>
            </Pressable>
          </View>
        )}
        ListFooterComponent={
          <Text style={styles.footnote}>
            Updates open in Obtainium if it is installed, otherwise the repository page.
          </Text>
        }
      />
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
  headerBody: { gap: 2 },
  headerTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  headerSub: { color: palette.textMuted, fontSize: fontSize.xs },
  headerSpacer: { flex: 1 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  version: { color: palette.accent, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  date: { color: palette.textMuted, fontSize: fontSize.xs },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  items: { gap: 6, marginTop: 2 },
  itemRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.accentAlt, marginTop: 7 },
  itemText: { flex: 1, color: palette.textMuted, fontSize: fontSize.sm, lineHeight: 20 },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
  },
  updatePressed: { opacity: 0.85 },
  updateText: { color: palette.textInverse, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  footnote: {
    color: palette.textMuted,
    fontSize: fontSize.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    lineHeight: 16,
  },
});
