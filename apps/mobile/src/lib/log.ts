/**
 * Tiny logger. Handled/expected failures (offline, a retried frame check, voice unavailable) are
 * logged at debug level in development only — never console.error/console.warn, which pop LogBox
 * overlays in dev and look like crashes. Release builds stay silent.
 */
declare const __DEV__: boolean | undefined;

const dev = (): boolean => typeof __DEV__ !== "undefined" && __DEV__ === true;

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return `${err.name}${typeof code === "string" ? `[${code}]` : ""}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export const log = {
  /** An error the UI already handles (message shown, retry scheduled). */
  handled(tag: string, err?: unknown): void {
    if (dev()) console.log(`[${tag}]`, err === undefined ? "" : describe(err));
  },
  debug(tag: string, ...args: unknown[]): void {
    if (dev()) console.log(`[${tag}]`, ...args);
  },
};
