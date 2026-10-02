/**
 * Tiny logger. Never log plaintext, keys or ciphertext — see the E2EE notes in
 * docs/ARCHITECTURE.md. Use `logger.scope('Chat')` to prefix messages.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

// `__DEV__` is injected by React Native; fall back to NODE_ENV when the same
// module is executed under plain Node (the crypto test harness does this).
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.NODE_ENV;
const enabled = typeof __DEV__ !== 'undefined' ? __DEV__ : nodeEnv !== 'production';

function emit(level: Level, scope: string, args: unknown[]): void {
  if (level === 'debug' && !enabled) return;
  const tag = `[${scope}]`;
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(tag, ...args);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function scope(name: string): Logger {
  return {
    debug: (...a) => emit('debug', name, a),
    info: (...a) => emit('info', name, a),
    warn: (...a) => emit('warn', name, a),
    error: (...a) => emit('error', name, a),
  };
}
