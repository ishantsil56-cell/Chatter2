import React, { useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { useUsers } from '@/store/userCache';
import { StatusScreen } from './StatusScreen';
import type { TabScreenProps } from '@/navigation/types';

/** Status tab: injects the current user's contacts/profiles into StatusScreen. */
export function StatusTabScreen({ navigation }: TabScreenProps<'Status'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { contacts } = useSavedContacts(uid);
  const contactIds = useMemo(() => contacts.map((c) => c.uid), [contacts]);
  const profiles = useUsers(contactIds);
  // Tabs live inside the app stack — reach up one level for stack screens.
  const parent = navigation.getParent();

  return (
    <StatusScreen
      myUid={uid ?? ''}
      contactIds={contactIds}
      profiles={profiles}
      onOpenStory={(ownerId) => parent?.navigate('StoryViewer' as never, { ownerId } as never)}
      onCreateStory={() => parent?.navigate('StoryComposer' as never)}
    />
  );
}
