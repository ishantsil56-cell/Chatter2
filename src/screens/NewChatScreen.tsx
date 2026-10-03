import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useContacts } from '@/hooks/useContacts';
import { Avatar } from '@/components/Avatar';
import type { Contact } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

export function NewChatScreen({ navigation }: AppScreenProps<'NewChat'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { lookup, startDirectChat, busy, error } = useContacts(uid);
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async (): Promise<void> => {
    setSearching(true);
    setContact(null);
    const found = await lookup(email);
    setContact(found);
    setSearching(false);
  };

  const open = async (): Promise<void> => {
    if (!contact) return;
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

      <Text style={styles.label}>Find someone by email</Text>
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
          onSubmitEditing={() => void search()}
        />
        <Pressable style={styles.searchButton} onPress={() => void search()} disabled={searching}>
          {searching ? (
            <ActivityIndicator color={palette.textInverse} />
          ) : (
            <Ionicons name="search" size={20} color={palette.textInverse} />
          )}
        </Pressable>
      </View>
      <Text style={styles.hint}>They need a Chatter account with that email.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {contact ? (
        <Pressable style={styles.contactRow} onPress={() => void open()} disabled={busy}>
          <Avatar
            name={contact.displayName || contact.email}
            photoURL={contact.photoURL}
            seed={contact.uid}
          />
          <View style={styles.contactBody}>
            <Text style={styles.contactName}>{contact.displayName || 'Chatter user'}</Text>
            <Text style={styles.contactEmail}>{contact.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
        </Pressable>
      ) : null}

      {contact ? (
        <Text style={styles.hint}>Tip: verify the safety number after you start chatting.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.lg },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  groupIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  groupText: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
  separator: { height: 1, backgroundColor: palette.border, marginVertical: spacing.sm },
  label: { color: palette.green, fontSize: fontSize.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  flex: { flex: 1 },
  searchButton: { width: 48, backgroundColor: palette.green, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  hint: { color: palette.textMuted, fontSize: fontSize.xs, marginTop: spacing.sm },
  error: { color: palette.danger, fontSize: fontSize.sm, marginTop: spacing.md },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  contactBody: { flex: 1 },
  contactName: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
  contactEmail: { color: palette.textMuted, fontSize: fontSize.sm },
});
