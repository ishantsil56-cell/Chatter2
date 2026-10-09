/**
 * Saved contacts.
 *
 * Stored per user at users/{uid}/contacts/{contactUid}, NOT on the profile
 * document. Profiles are readable by any signed-in user (that is how username
 * search works), so putting contacts there would publish who you know. The
 * subcollection has its own rule and is private to its owner.
 *
 * Each entry keeps a snapshot of the name and handle, so the contacts list
 * renders without fetching a profile per person — and still shows something
 * sensible if that person later changes their display name.
 */

import { db } from './firebase';
import type { Contact, SavedContact, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('contacts');

const USERS = 'users';
const CONTACTS = 'contacts';

function contactsRef(uid: UserId) {
  return db.collection(USERS).doc(uid).collection(CONTACTS);
}

/** Live list of saved contacts, sorted by name. */
export function subscribeContacts(uid: UserId, cb: (contacts: SavedContact[]) => void): () => void {
  return contactsRef(uid).onSnapshot(
    (snap) => {
      const list = snap.docs.map((d) => d.data() as SavedContact);
      list.sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username),
      );
      cb(list);
    },
    (err) => log.error('subscribeContacts failed', err),
  );
}

/** Save someone to contacts. Idempotent — adding twice just refreshes the entry. */
export async function addContact(ownerUid: UserId, contact: Contact): Promise<void> {
  await contactsRef(ownerUid)
    .doc(contact.uid)
    .set({
      uid: contact.uid,
      displayName: contact.displayName,
      username: contact.username,
      photoURL: contact.photoURL,
      addedAt: Date.now(),
    });
  log.info(`saved contact ${contact.uid}`);
}

export async function removeContact(ownerUid: UserId, contactUid: UserId): Promise<void> {
  await contactsRef(ownerUid).doc(contactUid).delete();
  log.info(`removed contact ${contactUid}`);
}
