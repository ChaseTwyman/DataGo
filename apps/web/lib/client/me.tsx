"use client";
/**
 * The signed-in account (GET /api/me) for the dashboard shell: which screens and rail items to show.
 * The server enforces every permission on its own; this only decides what to render.
 */
import type { Me } from "@groundtruth/shared";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiClientError } from "./api";

interface MeState {
  me: Me | null;
  /** Error code of the last failed load (e.g. ACCOUNT_SUSPENDED), or null. */
  errorCode: string | null;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (m: Me) => void;
}

const Ctx = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const errorCode = error instanceof ApiClientError ? error.code : error ? "unknown" : null;
  return <Ctx.Provider value={{ me, error, errorCode, loading, refresh, setMe }}>{children}</Ctx.Provider>;
}

export function useMe(): MeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe outside MeProvider");
  return v;
}

export { allowedWithoutResearcher } from "./access";
