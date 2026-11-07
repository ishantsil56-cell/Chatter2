import React, { useEffect, useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useLedgerStore } from '@/store/ledgerStore';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { chatTitle } from '@/components/ChatListItem';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import type { AppStackParamList } from '@/navigation/types';

/** Room for the floating tab bar. */
const TAB_CLEARANCE = 104;

/**
 * The shelf: one row per chat that holds records.
 *
 * Deliberately not a flat feed of entries. You remember *who* a thing was agreed
 * with long before you remember when, so the chat is the index and the entries
 * live behind it.
 */
export function LedgerScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const uid = useAuthStore((s) => s.uid);
  const { chats } = useChats(uid);
  const counts = useLedgerStore((s) => s.counts);
  const loading = useLedgerStore((s) => s.loadingShelf);
  const loadShelf = useLedgerStore((s) => s.loadShelf);

  const peerIds = useMemo(
    () => Array.from(new Set(chats.flatMap((c) => c.memberIds.filter((m) => m !== uid)))),
    [chats, uid],
  );
  const users = useUsers(peerIds);

  // Recount on focus: entries are added from inside a chat, so the shelf is stale
  // the moment you come back to it.
  useFocusEffect(
    React.useCallback(() => {
      if (!uid || chats.length === 0) return;
      void loadShelf(chats.map((c) => c.id));
    }, [uid, chats, loadShelf]),
  );

  const rows = useMemo(
    () => chats.filter((c) => (counts[c.id] ?? 0) > 0),
    [chats, counts],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Image source={require('../../assets/ledger-emblem.png')} style={styles.eye} resizeMode="contain" />
        <Text style={styles.title}>THE LEDGER</Text>
        <Text style={styles.subtitle}>Kept, by the members of each chamber.</Text>
      </View>

      {rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          {loading ? (
            <Text style={styles.loading}>Reading the ledger…</Text>
          ) : (
            <EmptyState
              icon="book-outline"
              title="No Records Yet"
              subtitle="End a message with !Record to save it here."
            />
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const n = counts[item.id] ?? 0;
            const title = chatTitle(item, uid ?? '', users);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() =>
                  navigation.navigate('LedgerChat', {
                    chatId: item.id,
                    name: title,
                    memberIds: item.memberIds,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${n} ${n === 1 ? 'record' : 'records'}`}
              >
                <Avatar name={title} photoURL={item.photoURL} seed={item.id} size={44} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {n} {n === 1 ? 'record' : 'records'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  header: { alignItems: 'center', paddingBottom: spacing.lg, paddingHorizontal: spacing.lg },
  // The emblem is a rendered mark with a ring and four spikes, not a glyph — it
  // needs room to read, where the eye was legible at 56.
  eye: { width: 84, height: 84 },
  title: {
    color: palette.text,
    fontSize: fontSize.xl,
    fontFamily: 'Cinzel_600SemiBold',
    letterSpacing: 3,
    marginTop: spacing.sm,
  },
  subtitle: { color: palette.textMuted, fontSize: fontSize.xs, marginTop: 4 },
  list: { paddingHorizontal: spacing.md, paddingBottom: TAB_CLEARANCE },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  rowPressed: { backgroundColor: palette.surfaceHigh },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  rowMeta: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  loading: { color: palette.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
});
