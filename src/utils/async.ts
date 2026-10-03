/**
 * Reject if a promise hasn't settled within `ms`.
 *
 * Used around network writes so a stalled operation surfaces as a visible error
 * instead of leaving the UI spinning forever with no feedback — which is
 * exactly what a hanging call used to do here.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out. Check your connection and try again.`)),
        ms,
      ),
    ),
  ]);
}
