import { useEffect, useState } from 'react';
import { subscribeChat } from '@/services/chats';
import { subscribeUser } from '@/services/users';
import type { Chat, UserProfile, UserId } from '@/types';

export interface UseChatResult {
  chat: Chat | null;
  /** Profiles of the other members (for titles/avatars). */
  partners: Record<UserId, UserProfile>;
  loading: boolean;
}

export function useChat(chatId: string | null, myUid: UserId | null): UseChatResult {
  const [chat, setChat] = useState<Chat | null>(null);
  const [partners, setPartners] = useState<Record<UserId, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chatId) return;
    const unsub = subscribeChat(chatId, (next) => {
      setChat(next);
      setLoading(false);
    });
    return unsub;
  }, [chatId]);

  useEffect(() => {
    if (!chat || !myUid) return;
    const others = chat.memberIds.filter((m) => m !== myUid);
    const unsubs = others.map((uid) =>
      subscribeUser(uid, (profile) => {
        if (profile) setPartners((prev) => ({ ...prev, [uid]: profile }));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [chat, myUid]);

  return { chat, partners, loading };
}
