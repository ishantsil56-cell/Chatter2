import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useContacts } from '@/hooks/useContacts';
import { createGroup } from '@/services/chats';
import { Avatar } from '@/components/Avatar';
import { scope } from '@/utils/logger';
import type { Contact } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('GroupCreate');

export function GroupCreateScreen({ navigation }: AppScreenProps<'GroupCreate'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { lookup } = useContacts(uid);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMember = async (): Promise<void> => {
    const contact = await lookup(email);
    if (contact && !members.some((m) => m.uid === contact.uid)) {
      setMembers((prev) => [...prev, contact]);
      setEmail('');
    }
  };

  const removeMember = (uidToRemove: string): void => setMembers((prev) => prev.filter((m) => m.uid !== uidToRemove));

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
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
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

      <Text style={styles.label}>Add members by email</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={email}
          onChangeText={setEmail}
          placeholder="friend@example.com"
          placeholderTextColor={palette.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void addMember()}
        />
        <Pressable style={styles.addButton} onPress={() => void addMember()}>
          <Ionicons name="add" size={22} color={palette.textInverse} />
        </Pressable>
      </View>

      {members.map((member) => (
        <View key={member.uid} style={styles.memberRow}>
          <Avatar name={member.displayName || member.email} photoURL={member.photoURL} size={40} seed={member.uid} />
          <Text style={styles.memberName}>{member.displayName || member.email}</Text>
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
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  flex: { flex: 1 },
  addButton: { width: 48, backgroundColor: palette.green, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  memberName: { flex: 1, color: palette.text, fontSize: fontSize.md },
  error: { color: palette.danger, fontSize: fontSize.sm, marginTop: spacing.md },
  createButton: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  disabled: { opacity: 0.6 },
  createText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
