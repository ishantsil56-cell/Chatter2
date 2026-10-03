import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useContacts } from '@/hooks/useContacts';
import { createGroup } from '@/services/chats';
import { Avatar } from '@/components/Avatar';
import { displayUsername } from '@/utils/username';
import { scope } from '@/utils/logger';
import type { Contact } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('GroupCreate');

export function GroupCreateScreen({ navigation }: AppScreenProps<'GroupCreate'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { search } = useContacts(uid);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [members, setMembers] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (): Promise<void> => {
    setSearching(true);
    const found = await search(query);
    setResults(found.filter((c) => !members.some((m) => m.uid === c.uid)));
    setSearching(false);
  };

  const addMember = (contact: Contact): void => {
    setMembers((prev) => [...prev, contact]);
    setResults((prev) => prev.filter((c) => c.uid !== contact.uid));
    setQuery('');
  };

  const removeMember = (memberId: string): void => setMembers((prev) => prev.filter((m) => m.uid !== memberId));

  const create = async (): Promise<void> => {
    if (!uid || !name.trim()) {
      setError('Give the group a name.');
      return;
    }
    if (members.length === 0) {
      setError('Add at least one member.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chatId = await createGroup(uid, members.map((m) => m.uid), name.trim());
      navigation.replace('Chat', { chatId });
    } catch (e) {
      log.error('create group failed', e);
      setError('Could not create the group. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.avatarRow}>
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={28} color={palette.textInverse} />
        </View>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor={palette.textMuted}
        />
      </View>

      <Text style={styles.label}>Add members by username</Text>
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
        <Pressable style={styles.addButton} onPress={() => void runSearch()} disabled={searching}>
          {searching ? <ActivityIndicator color={palette.textInverse} /> : <Ionicons name="search" size={20} color={palette.textInverse} />}
        </Pressable>
      </View>

      {results.map((contact) => (
        <Pressable key={contact.uid} style={styles.resultRow} onPress={() => addMember(contact)}>
          <Avatar name={contact.displayName || contact.username} photoURL={contact.photoURL} size={40} seed={contact.uid} />
          <View style={styles.resultBody}>
            <Text style={styles.resultName}>{contact.displayName || displayUsername(contact.username)}</Text>
            <Text style={styles.resultHandle}>{displayUsername(contact.username)}</Text>
          </View>
          <Ionicons name="add-circle" size={22} color={palette.green} />
        </Pressable>
      ))}

      {members.length > 0 ? <Text style={styles.label}>Members ({members.length})</Text> : null}
      {members.map((member) => (
        <View key={member.uid} style={styles.memberRow}>
          <Avatar name={member.displayName || member.username} photoURL={member.photoURL} size={40} seed={member.uid} />
          <Text style={styles.memberName}>{member.displayName || displayUsername(member.username)}</Text>
          <Pressable onPress={() => removeMember(member.uid)} hitSlop={8}>
            <Ionicons name="close" size={20} color={palette.textMuted} />
          </Pressable>
        </View>
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.createButton, busy && styles.disabled]} onPress={() => void create()} disabled={busy}>
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.createText}>Create group</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  content: { padding: spacing.lg },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  groupIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  nameInput: { flex: 1, color: palette.text, fontSize: fontSize.lg, borderBottomWidth: 1, borderBottomColor: palette.green, paddingVertical: spacing.sm },
  label: { color: palette.green, fontSize: fontSize.sm, marginTop: spacing.xl, marginBottom: spacing.sm },
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
  addButton: { width: 48, backgroundColor: palette.green, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  resultBody: { flex: 1 },
  resultName: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  resultHandle: { color: palette.textMuted, fontSize: fontSize.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  memberName: { flex: 1, color: palette.text, fontSize: fontSize.md },
  error: { color: palette.danger, fontSize: fontSize.sm, marginTop: spacing.md },
  createButton: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  disabled: { opacity: 0.6 },
  createText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
