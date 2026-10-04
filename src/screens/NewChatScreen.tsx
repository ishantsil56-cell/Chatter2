import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { ErrorBanner } from '@/components/ErrorBanner';
import { useAuthStore } from '@/store/authStore';
import { useContacts } from '@/hooks/useContacts';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { displayUsername } from '@/utils/username';
import type { Contact } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

export function NewChatScreen({ navigation }: AppScreenProps<'NewChat'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { search, startDirectChat, busy, error } = useContacts(uid);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const runSearch = async (): Promise<void> => {
    setSearching(true);
    setSearched(true);
    const found = await search(query);
    setResults(found);
    setSearching(false);
  };

  const open = async (contact: Contact): Promise<void> => {
    const chatId = await startDirectChat(contact.uid);
    if (chatId) navigation.replace('Chat', { chatId });
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.groupRow} onPress={() => navigation.navigate('GroupCreate')}>
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={22} color={palette.textInverse} />
        </View>
        <Text style={styles.groupText}>New group</Text>
      </Pressable>

      <View style={styles.separator} />

      <Text style={styles.label}>Find someone by username</Text>
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <Text style={styles.at}>@</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="search a username"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void runSearch()}
          />
        </View>
        <Pressable style={styles.searchButton} onPress={() => void runSearch()} disabled={searching}>
          {searching ? <ActivityIndicator color={palette.textInverse} /> : <Ionicons name="search" size={20} color={palette.textInverse} />}
        </Pressable>
      </View>

      <ErrorBanner message={error} />

      <FlatList
        data={results}
        keyExtractor={(item) => item.uid}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={styles.contactRow} onPress={() => void open(item)} disabled={busy}>
            <Avatar name={item.displayName || item.username} photoURL={item.photoURL} seed={item.uid} />
            <View style={styles.contactBody}>
              <Text style={styles.contactName}>{item.displayName || displayUsername(item.username)}</Text>
              <Text style={styles.contactHandle}>{displayUsername(item.username)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          searched && !searching ? (
            <EmptyState icon="person-outline" title="No matches" subtitle="Try a different username." />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.lg },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  groupIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  groupText: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
  separator: { height: 1, backgroundColor: palette.border, marginVertical: spacing.sm },
  label: { color: palette.accent, fontSize: fontSize.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  at: { color: palette.textMuted, fontSize: fontSize.md },
  input: { flex: 1, color: palette.text, paddingVertical: spacing.md, fontSize: fontSize.md },
  searchButton: { width: 48, backgroundColor: palette.accent, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  list: { marginTop: spacing.md },
  error: { color: palette.danger, fontSize: fontSize.sm, marginTop: spacing.md },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  contactBody: { flex: 1 },
  contactName: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
  contactHandle: { color: palette.textMuted, fontSize: fontSize.sm },
});
