/**
 * Next.js startup hook: fail loudly at boot (not on some later request) when MOCK_GROK=1 would run
 * against a real database. lib/db repeats the check on first connection for scripts and tests.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertMockGrokAllowed } = await import("./lib/env");
  assertMockGrokAllowed();
}
