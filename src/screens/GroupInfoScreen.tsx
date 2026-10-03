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
import { scope } from '@/utils/logger';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('GroupInfo');

export function GroupInfoScreen({ route, navigation }: AppScreenProps<'GroupInfo'>): React.JSX.Element {
  const { chatId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const { chat } = useChat(chatId, uid);
  const users = useUsers(chat?.memberIds ?? []);
  const { lookup } = useContacts(uid);

  const [name, setName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [editingName, setEditingName] = useState(false);

  const isAdmin = Boolean(uid && chat?.adminIds?.includes(uid));

  const saveName = async (): Promise<void> => {
    if (!name.trim()) return;
    await renameGroup(chatId, name.trim());
    setEditingName(false);
    setName('');
  };

  const handleAdd = async (): Promise<void> => {
    if (!uid) return;
    const contact = await lookup(addEmail);
    if (contact) {
      await addMembers(chatId, [contact.uid], uid);
      setAddEmail('');
    }
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
          <Text style={styles.section}>Add member</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={addEmail}
              onChangeText={setAddEmail}
              placeholder="friend@example.com"
              placeholderTextColor={palette.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => void handleAdd()}
            />
            <Pressable style={styles.addButton} onPress={() => void handleAdd()}>
              <Ionicons name="add" size={22} color={palette.textInverse} />
            </Pressable>
          </View>
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
  badge: { color: palette.green, fontSize: fontSize.xs, borderWidth: 1, borderColor: palette.green, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  flex: { flex: 1 },
  addButton: { width: 48, backgroundColor: palette.green, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  leaveButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl, paddingVertical: spacing.md },
  leaveText: { color: palette.danger, fontSize: fontSize.md, fontWeight: fontWeight.medium },
});
