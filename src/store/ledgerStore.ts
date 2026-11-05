/**
 * Ledger state.
 *
 * Two levels, cached separately: counts for the shelf, and the opened entries
 * for one chat. Nothing subscribes to every chat's ledger at once — that would
 * be one listener per conversation, which the free tier cannot afford and the
 * user does not need.
 */

import { create } from 'zustand';
import { fetchEntries, openEntry, primeLedgerKey, type LedgerEntry } from '@/services/ledger';
import { scope } from '@/utils/logger';
import type { SessionManager } from '@/services/crypto/session';
import type { ChatId, UserId } from '@/types';

const log = scope('ledgerStore');

/** An entry plus its decrypted text. `text: null` means it could not be opened. */
export type LedgerItem = LedgerEntry & { text: string | null };

interface LedgerState {
  /** chatId -> number of entries known to exist. Absent means "none". */
  counts: Record<ChatId, number>;
  loadingShelf: boolean;
  shelfLoaded: boolean;
  entries: Record<ChatId, LedgerItem[]>;
  loadingEntries: Record<ChatId, boolean>;

  loadShelf(chatIds: ChatId[]): Promise<void>;
  loadEntries(crypto: SessionManager, chatId: ChatId, myUid: UserId, memberIds: UserId[]): Promise<void>;
  removeEntry(chatId: ChatId, entryId: string): void;
  reset(): void;
}

/** How many entries a shelf row counts before it stops counting. */
const COUNT_CAP = 25;
/** How many entries one chat opens at a time. */
const PAGE = 50;

export const useLedgerStore = create<LedgerState>((set, get) => ({
  counts: {},
  loadingShelf: false,
  shelfLoaded: false,
  entries: {},
  loadingEntries: {},

  loadShelf: async (chatIds) => {
    set({ loadingShelf: true });
    const counts: Record<ChatId, number> = {};
    await Promise.all(
      chatIds.map(async (chatId) => {
        try {
          const rows = await fetchEntries(chatId, COUNT_CAP);
          if (rows.length > 0) counts[chatId] = rows.length;
        } catch (e) {
          // A chat whose ledger cannot be read simply does not appear, rather
          // than failing the whole shelf.
          log.warn(`could not count ledger entries for ${chatId}`, e);
        }
      }),
    );
    set({ counts, loadingShelf: false, shelfLoaded: true });
  },

  loadEntries: async (crypto, chatId, myUid, memberIds) => {
    set((s) => ({ loadingEntries: { ...s.loadingEntries, [chatId]: true } }));
    try {
      // Unwrap (or create) the chat's ledger key first. Without it every entry
      // below would open to null and the shelf would look empty.
      await primeLedgerKey(crypto, chatId, myUid, memberIds);
      const raw = await fetchEntries(chatId, PAGE);
      const items: LedgerItem[] = await Promise.all(
        raw.map(async (entry) => ({ ...entry, text: await openEntry(crypto, entry, myUid) })),
      );
      set((s) => ({ entries: { ...s.entries, [chatId]: items } }));
    } catch (e) {
      log.warn(`could not load ledger entries for ${chatId}`, e);
      set((s) => ({ entries: { ...s.entries, [chatId]: [] } }));
    } finally {
      set((s) => ({ loadingEntries: { ...s.loadingEntries, [chatId]: false } }));
    }
  },

  removeEntry: (chatId, entryId) => {
    const current = get().entries[chatId] ?? [];
    const remaining = current.filter((e) => e.id !== entryId);
    set((s) => ({
      entries: { ...s.entries, [chatId]: remaining },
      counts: {
        ...s.counts,
        [chatId]: Math.max(0, (s.counts[chatId] ?? 1) - 1),
      },
    }));
  },

  reset: () => set({ counts: {}, entries: {}, shelfLoaded: false, loadingEntries: {} }),
}));
