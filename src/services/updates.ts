/**
 * Getting a newer build.
 *
 * IRIS is distributed through GitHub, not a store, so an "update" button has to
 * work in two worlds: a phone with Obtainium installed, which can update in
 * place, and a phone without it, which needs the repository page.
 *
 * Obtainium registers the `obtainium://` scheme. The `app` action takes a
 * URL-encoded config and shows a confirmation before adding anything, which is
 * exactly what we want — one tap, one confirm, no silent install.
 */

import { Linking } from 'react-native';
import { scope } from '@/utils/logger';

const log = scope('updates');

export const REPO_URL = 'https://github.com/ishantsil56-cell/Chatter2';
export const REPO_RELEASES_URL = `${REPO_URL}/releases/latest`;

/** What Obtainium needs to track IRIS. `id` is only a local bookkeeping key. */
const OBTAINIUM_CONFIG = {
  id: 'com.sil.chatter',
  url: REPO_URL,
  author: 'ishantsil56-cell',
  name: 'IRIS',
};

/**
 * Open Obtainium if it will take the link, otherwise the repository page.
 *
 * The deep link is attempted directly rather than probed with `canOpenURL`.
 * On Android 11+ `canOpenURL` returns false for any scheme not declared in the
 * manifest's `<queries>`, so probing would report "no Obtainium" on phones that
 * have it. Trying and catching the failure is both simpler and more accurate.
 */
export async function openUpdate(): Promise<void> {
  const deep = `obtainium://app/${encodeURIComponent(JSON.stringify(OBTAINIUM_CONFIG))}`;
  try {
    await Linking.openURL(deep);
    return;
  } catch (e) {
    log.info('no Obtainium to hand off to; opening the repository instead', e);
  }
  try {
    await Linking.openURL(REPO_RELEASES_URL);
  } catch (e) {
    log.warn('could not open the repository page either', e);
    await Linking.openURL(REPO_URL).catch(() => undefined);
  }
}
