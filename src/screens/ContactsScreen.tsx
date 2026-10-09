import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { useDialog } from '@/components/AppDialog';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { BlinkingLogo } from '@/components/BlinkingLogo';
import { ensureDirectChat } from '@/services/chats';
import { removeContact } from '@/services/contacts';
import { displayUsername } from '@/utils/username';
import { scope } from '@/utils/logger';
import type { SavedContact } from '@/types';
import type { TabScreenProps } from '@/navigation/types';

const log = scope('Contacts');

export function ContactsScreen({ navigation }: TabScreenProps<'Contacts'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { contacts, loading } = useSavedContacts(uid);
  const dialog = useDialog();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.username.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const openChat = useCallback(
    async (contact: SavedContact): Promise<void> => {
      if (!uid) return;
      try {
        const chatId = await ensureDirectChat(uid, contact.uid);
        navigation.navigate('Chat', { chatId });
      } catch (e) {
        log.warn('could not open chat', e);
      }
    },
    [uid, navigation],
  );

  const confirmRemove = useCallback(
    async (contact: SavedContact): Promise<void> => {
      if (!uid) return;
      const ok = await dialog({
        title: 'Remove contact?',
        message: `${contact.displayName} will be removed from your contacts. You can still find them by username, and any chats you share stay as they are.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      void removeContact(uid, contact.uid).catch((e) => log.warn('remove failed', e));
    },
    [uid, dialog],
  );

  if (loading && contacts.length === 0) {
    return (
      <View style={styles.wrap}>
        <View style={styles.loading}>
          <BlinkingLogo size={72} />
        </View>
      </View>
    );
  }

  if (contacts.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon="people-outline"
          title="No contacts yet"
          subtitle="Open a chat and tap the add-person button in the header to save someone here."
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => void openChat(item)}
            onLongPress={() => void confirmRemove(item)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`${item.displayName}, ${displayUsername(item.username)}`}
            accessibilityHint="Opens a chat. Long-press to remove from contacts."
          >
            <Avatar name={item.displayName} photoURL={item.photoURL} seed={item.uid} />
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text style={styles.handle} numberOfLines={1}>
                {displayUsername(item.username)}
              </Text>
            </View>
            <Ionicons name="chatbubble-outline" size={19} color={palette.textMuted} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              subtitle="No contact matches that name."
            />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: palette.text, fontSize: fontSize.md, paddingVertical: spacing.sm },
  list: { paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: { flex: 1 },
  name: { color: palette.text, fontSize: fontSize.md },
  handle: { color: palette.textMuted, fontSize: fontSize.sm },
  separator: { height: 1, backgroundColor: palette.border, marginLeft: 80 },
});
