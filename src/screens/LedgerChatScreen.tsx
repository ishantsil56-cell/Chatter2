import React, { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useLedgerStore, type LedgerItem } from '@/store/ledgerStore';
import { useDialog } from '@/components/AppDialog';
import { LedgerCard } from '@/components/LedgerCard';
import { EmptyState } from '@/components/EmptyState';
import { deleteEntry } from '@/services/ledger';
import { getCrypto } from '@/services/crypto';
import { scope } from '@/utils/logger';
import type { AppStackParamList } from '@/navigation/types';

const log = scope('LedgerChat');

interface Props {
  route: { params: { chatId: string; name?: string; memberIds: string[] } };
}

/** One chat's records, as flashcards, newest first. */
export function LedgerChatScreen({ route }: Props): React.JSX.Element {
  const { chatId, name, memberIds } = route.params;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const dialog = useDialog();
  const uid = useAuthStore((s) => s.uid);
  const crypto = getCrypto();
  const items = useLedgerStore((s) => s.entries[chatId]);
  const loading = useLedgerStore((s) => s.loadingEntries[chatId]);
  const loadEntries = useLedgerStore((s) => s.loadEntries);
  const removeEntry = useLedgerStore((s) => s.removeEntry);

  useEffect(() => {
    if (!uid) return;
    void loadEntries(crypto, chatId, uid, memberIds);
    // memberIds comes from the route and is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, chatId, loadEntries]);

  const onLongPress = (item: LedgerItem): void => {
    void (async () => {
      const ok = await dialog({
        title: 'Remove this record?',
        message:
          'It will be removed from the Ledger for everyone in this chat. The original message stays in the conversation.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      try {
        await deleteEntry(chatId, item.id);
        removeEntry(chatId, item.id);
      } catch (e) {
        log.warn('could not remove a ledger entry', e);
      }
    })();
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name ?? 'The Ledger'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {items === undefined || (loading && items.length === 0) ? (
        <View style={styles.centre}>
          <Text style={styles.loading}>Opening the ledger…</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centre}>
          <EmptyState
            icon="document-text-outline"
            title="No Entries Here"
            subtitle="This chat has no recorded messages yet."
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <LedgerCard item={item} onLongPress={onLongPress} />}
        />
      )}
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
  headerTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, flexShrink: 1 },
  headerSpacer: { flex: 1 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  centre: { flex: 1, justifyContent: 'center' },
  loading: { color: palette.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
});
