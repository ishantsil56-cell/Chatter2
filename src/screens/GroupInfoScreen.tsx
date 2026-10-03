import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { useUsers } from '@/store/userCache';
import { useContacts } from '@/hooks/useContacts';
import { addMembers, removeMember, leaveGroup, renameGroup } from '@/services/chats';
import { Avatar } from '@/components/Avatar';
import { displayUsername } from '@/utils/username';
import { scope } from '@/utils/logger';
import type { Contact } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('GroupInfo');

export function GroupInfoScreen({ route, navigation }: AppScreenProps<'GroupInfo'>): React.JSX.Element {
  const { chatId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const { chat } = useChat(chatId, uid);
  const users = useUsers(chat?.memberIds ?? []);
  const { search } = useContacts(uid);

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [editingName, setEditingName] = useState(false);

  const isAdmin = Boolean(uid && chat?.adminIds?.includes(uid));

  const saveName = async (): Promise<void> => {
    if (!name.trim()) return;
    await renameGroup(chatId, name.trim());
    setEditingName(false);
    setName('');
  };

  const runSearch = async (): Promise<void> => {
    const found = await search(query);
    setResults(found);
  };

  const addMember = async (contact: Contact): Promise<void> => {
    if (!uid) return;
    await addMembers(chatId, [contact.uid], uid);
    setResults((prev) => prev.filter((c) => c.uid !== contact.uid));
    setQuery('');
  };

  const handleRemove = async (memberId: string): Promise<void> => {
    if (!uid) return;
    try {
      await removeMember(chatId, memberId, uid);
    } catch (e) {
      log.error('remove failed', e);
    }
  };

  const handleLeave = async (): Promise<void> => {
    if (!uid) return;
    await leaveGroup(chatId, uid);
    navigation.popToTop();
  };

  if (!chat) return <View style={styles.wrap} />;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Avatar name={chat.name ?? 'Group'} seed={chat.id} size={64} />
        {editingName ? (
          <View style={styles.renameRow}>
            <TextInput
              style={styles.renameInput}
              value={name}
              onChangeText={setName}
              placeholder={chat.name ?? 'Group name'}
              placeholderTextColor={palette.textMuted}
              autoFocus
            />
            <Pressable onPress={() => void saveName()}>
              <Ionicons name="checkmark" size={22} color={palette.green} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <Text style={styles.groupName}>{chat.name ?? 'Group'}</Text>
            {isAdmin ? (
              <Pressable onPress={() => setEditingName(true)} hitSlop={8}>
                <Ionicons name="pencil" size={18} color={palette.textMuted} />
              </Pressable>
            ) : null}
          </View>
        )}
        <Text style={styles.memberCount}>{chat.memberIds.length} members</Text>
      </View>

      <Text style={styles.section}>Members</Text>
      {chat.memberIds.map((memberId) => {
        const profile = users[memberId];
        const label = memberId === uid ? 'You' : profile?.displayName || profile?.email || memberId.slice(0, 8);
        const admin = chat.adminIds?.includes(memberId);
        return (
          <View key={memberId} style={styles.memberRow}>
            <Avatar name={label} photoURL={profile?.photoURL} size={40} seed={memberId} />
            <Text style={styles.memberName}>{label}</Text>
            {admin ? <Text style={styles.badge}>admin</Text> : null}
            {isAdmin && memberId !== uid ? (
              <Pressable onPress={() => void handleRemove(memberId)} hitSlop={8}>
                <Ionicons name="remove-circle-outline" size={20} color={palette.danger} />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {isAdmin ? (
        <>
          <Text style={styles.section}>Add member by username</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={query}
              onChangeText={setQuery}
              placeholder="@username"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => void runSearch()}
            />
            <Pressable style={styles.addButton} onPress={() => void runSearch()}>
              <Ionicons name="search" size={20} color={palette.textInverse} />
            </Pressable>
          </View>
          {results.map((contact) => (
            <Pressable key={contact.uid} style={styles.resultRow} onPress={() => void addMember(contact)}>
              <Avatar name={contact.displayName || contact.username} photoURL={contact.photoURL} size={40} seed={contact.uid} />
              <View style={styles.resultBody}>
                <Text style={styles.resultName}>{contact.displayName || displayUsername(contact.username)}</Text>
                <Text style={styles.resultHandle}>{displayUsername(contact.username)}</Text>
              </View>
              <Ionicons name="add-circle" size={22} color={palette.green} />
            </Pressable>
          ))}
        </>
      ) : null}

      <Pressable style={styles.leaveButton} onPress={() => void handleLeave()}>
        <Ionicons name="exit-outline" size={20} color={palette.danger} />
        <Text style={styles.leaveText}>Leave group</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  content: { padding: spacing.lg },
  headerRow: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  renameInput: { color: palette.text, fontSize: fontSize.lg, borderBottomWidth: 1, borderBottomColor: palette.green, paddingVertical: spacing.xs, minWidth: 160 },
  groupName: { color: palette.text, fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
  memberCount: { color: palette.textMuted, fontSize: fontSize.sm },
  section: { color: palette.green, fontSize: fontSize.sm, marginTop: spacing.xl, marginBottom: spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  memberName: { flex: 1, color: palette.text, fontSize: fontSize.md },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  resultBody: { flex: 1 },
  resultName: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  resultHandle: { color: palette.textMuted, fontSize: fontSize.sm },
  badge: { color: palette.green, fontSize: fontSize.xs, borderWidth: 1, borderColor: palette.green, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  flex: { flex: 1 },
  addButton: { width: 48, backgroundColor: palette.green, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  leaveButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl, paddingVertical: spacing.md },
  leaveText: { color: palette.danger, fontSize: fontSize.md, fontWeight: fontWeight.medium },
});
