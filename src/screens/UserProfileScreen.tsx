import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { useDialog } from '@/components/AppDialog';
import { ErrorBanner } from '@/components/ErrorBanner';
import { useAuthStore } from '@/store/authStore';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { subscribeUser } from '@/services/users';
import { addContact, removeContact } from '@/services/contacts';
import { addMembers, ensureDirectChat, subscribeChats } from '@/services/chats';
import { displayUsername } from '@/utils/username';
import { friendlyError } from '@/utils/errors';
import { scope } from '@/utils/logger';
import type { Chat, UserProfile } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('UserProfile');

/**
 * Someone else's profile.
 *
 * Deliberately separate from `ProfileScreen`, which edits your own account.
 * This one is read-only and offers what you would want to do *about* another
 * person: message them, save them, or pull them into a group.
 *
 * The group picker is inline rather than a dialog, because `useDialog` is a
 * yes/no confirm — it has no way to present a list of choices.
 */
export function UserProfileScreen({ route, navigation }: AppScreenProps<'UserProfile'>): React.JSX.Element {
  const { uid: subjectUid } = route.params;
  const myUid = useAuthStore((s) => s.uid);
  const dialog = useDialog();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [myGroups, setMyGroups] = useState<Chat[]>([]);
  const [picking, setPicking] = useState(false);

  const { contacts } = useSavedContacts(myUid);
  const isSaved = contacts.some((c) => c.uid === subjectUid);
  const isMe = myUid === subjectUid;

  useEffect(() => {
    setLoading(true);
    return subscribeUser(subjectUid, (p) => {
      setProfile(p);
      setLoading(false);
    });
  }, [subjectUid]);

  // Only needed for "Add to a group", so it stays cheap until then.
  useEffect(() => {
    if (!myUid) return;
    return subscribeChats(myUid, (list) => {
      // A group is a chat that has a name; direct chats derive theirs.
      setMyGroups(list.filter((c) => c.name != null));
    });
  }, [myUid]);

  const label = profile?.displayName || profile?.username || 'Member';

  const openChat = async (): Promise<void> => {
    if (!myUid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chatId = await ensureDirectChat(myUid, subjectUid);
      navigation.navigate('Chat', { chatId });
    } catch (e) {
      log.error('could not open chat', e);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSave = async (): Promise<void> => {
    if (!myUid || !profile || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSaved) {
        await removeContact(myUid, subjectUid);
      } else {
        await addContact(myUid, {
          uid: subjectUid,
          username: profile.username,
          displayName: profile.displayName,
          email: profile.email,
          photoURL: profile.photoURL,
        });
      }
    } catch (e) {
      log.error('could not change contact', e);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const addToGroup = async (chat: Chat): Promise<void> => {
    if (!myUid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMembers(chat.id, [subjectUid], myUid);
      setPicking(false);
      await dialog({ title: 'Added', message: `${label} is now in ${chat.name ?? 'the group'}.`, cancelLabel: null });
    } catch (e) {
      log.error('could not add to group', e);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const startAddToGroup = (): void => {
    if (myGroups.length === 0) {
      void dialog({ title: 'No groups yet', message: 'Create a group first, then you can add people to it.', cancelLabel: null });
      return;
    }
    setPicking((p) => !p);
  };

  if (loading) {
    return (
      <View style={[styles.wrap, styles.centre]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Avatar name={label} photoURL={profile?.photoURL} size={104} seed={subjectUid} />
        <Text style={styles.name}>{label}</Text>
        {profile?.username ? <Text style={styles.handle}>{displayUsername(profile.username)}</Text> : null}
        {profile?.about ? <Text style={styles.about}>{profile.about}</Text> : null}
      </View>

      <ErrorBanner message={error} />

      {!isMe ? (
        <>
          <Pressable style={[styles.action, styles.primary]} onPress={() => void openChat()} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={palette.textInverse} />
            ) : (
              <>
                <Ionicons name="chatbubble-outline" size={20} color={palette.textInverse} />
                <Text style={styles.primaryText}>Message</Text>
              </>
            )}
          </Pressable>

          <Pressable style={styles.action} onPress={() => void toggleSave()} disabled={busy}>
            <Ionicons name={isSaved ? 'person-remove-outline' : 'person-add-outline'} size={20} color={palette.accent} />
            <Text style={styles.actionText}>{isSaved ? 'Remove from contacts' : 'Save to contacts'}</Text>
          </Pressable>

          <Pressable style={styles.action} onPress={startAddToGroup} disabled={busy}>
            <Ionicons name="people-outline" size={20} color={palette.accent} />
            <Text style={styles.actionText}>Add to a group</Text>
          </Pressable>

          {picking
            ? myGroups.map((g) => (
                <Pressable key={g.id} style={styles.groupRow} onPress={() => void addToGroup(g)} disabled={busy}>
                  <Ionicons name="people-circle-outline" size={22} color={palette.accent} />
                  <Text style={styles.groupName} numberOfLines={1}>
                    {g.name ?? 'Group'}
                  </Text>
                  <Text style={styles.groupCount}>{g.memberIds.length}</Text>
                </Pressable>
              ))
            : null}
        </>
      ) : (
        <Pressable style={styles.action} onPress={() => navigation.navigate('Profile')}>
          <Ionicons name="create-outline" size={20} color={palette.accent} />
          <Text style={styles.actionText}>Edit my profile</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  head: { alignItems: 'center', marginBottom: spacing.xl, gap: spacing.xs },
  name: {
    color: palette.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  handle: { color: palette.accent, fontSize: fontSize.md },
  about: { color: palette.textMuted, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  actionText: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  primary: { backgroundColor: palette.accent, marginTop: spacing.lg },
  primaryText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  groupName: { flex: 1, color: palette.text, fontSize: fontSize.md },
  groupCount: { color: palette.textMuted, fontSize: fontSize.sm },
});
