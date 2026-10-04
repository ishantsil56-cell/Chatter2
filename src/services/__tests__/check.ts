/** Minimal assertion helper shared by the Node test harnesses (no test framework needed). */
let passed = 0;
let failed = 0;

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail !== undefined ? ` — ${String(detail)}` : ''}`);
  }
}

export async function rejects(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

export function finish(label: string): void {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
