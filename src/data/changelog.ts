/**
 * What changed, and when.
 *
 * Kept in the app rather than fetched, deliberately: this has to work with no
 * network, no server and no account, and it must never show a blank screen
 * because a request failed. The cost is that a new release needs an entry added
 * here — which is a fair trade for a feature whose whole job is to explain what
 * shipped.
 *
 * Newest first. `version` is compared against the installed version to decide
 * whether to offer an update.
 */

export interface Release {
  version: string;
  /** ISO date. */
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '1.5.0',
    date: '2026-11-07',
    title: 'The Ledger',
    items: [
      'Record a message by ending it with !Record — case sensitive, at the very end.',
      'Recorded messages are kept in a fourth tab, grouped by chat, and survive the original being deleted.',
      'Each record is a card with the date, the time and who wrote it. Long-press one to remove it.',
      'The trailing !Record is drawn in red and opens that chat\u2019s records.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-05',
    title: 'Locked',
    items: [
      'App lock: a 4-digit PIN, with your fingerprint or face if you want it.',
      'IRIS blurs itself when it goes to the background, so the recent-apps view shows nothing.',
      'Long-press the IRIS mark on the chat list to hide everything instantly.',
      'Auto-lock after 15 seconds by default, adjustable in Settings.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-04',
    title: 'Proof',
    items: [
      'Safety numbers: compare a code with a contact to check nobody is between you.',
      'You are now warned when someone\u2019s security code changes \u2014 the signal that matters most.',
      'The code is computed on your phone and never sent anywhere.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-03',
    title: 'Quieter',
    items: [
      'Notifications now fire only for a real new message \u2014 no more banners over chats with nothing new in them.',
      'Your own messages no longer notify you.',
      'Messages you have already read no longer notify you again.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-26',
    title: 'A new face',
    items: [
      'New palette, headers and conversation cards.',
      'The IRIS mark sits in the header, and the eye glows on its own with no plate behind it.',
      'Each person gets their own two-tone gradient avatar.',
      'Glassy navigation bar with a lit active tab.',
    ],
  },
];

/** The newest release in the list. */
export const LATEST_RELEASE = CHANGELOG[0];

/**
 * Compare two dotted versions.
 *
 * Returns a positive number when `a` is newer than `b`, negative when older, 0
 * when equal. Deliberately simple: these are hand-written versions in one file,
 * not semver from a registry.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
