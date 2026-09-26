/**
 * Outbound HTTP for context data (Open-Meteo, NWS). Injectable so tests never hit the network:
 * tests call setContextFetch(stub). OFFLINE_CONTEXT=1 makes callers skip the calls entirely.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const g = globalThis as typeof globalThis & { __gtFetch?: { impl: FetchLike | null } };
const slot = (g.__gtFetch ??= { impl: null });

export function contextFetch(): FetchLike {
  return slot.impl ?? ((input, init) => fetch(input, init));
}

export function setContextFetch(impl: FetchLike | null): void {
  slot.impl = impl;
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 5000, ...rest } = init;
  const res = await contextFetch()(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url.split("?")[0]} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
