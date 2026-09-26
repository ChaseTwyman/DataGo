"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { LenientHealthResponse as HealthResponse } from "@groundtruth/shared";
import { api } from "./api";
import type { HealthState } from "./stream";

export interface HealthInfo {
  state: HealthState;
  data: HealthResponse | null;
}

const HealthContext = createContext<HealthInfo>({ state: { status: "loading" }, data: null });

/** Loads GET /api/health once for the dashboard: backend mode, realtime, demo mode, mock Grok. */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<HealthInfo>({ state: { status: "loading" }, data: null });
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => alive && setInfo({ state: { status: "ready", realtime: h.realtime, backend: h.backend }, data: h }))
      .catch(() => alive && setInfo({ state: { status: "error" }, data: null }));
    return () => {
      alive = false;
    };
  }, []);
  return <HealthContext.Provider value={info}>{children}</HealthContext.Provider>;
}

export const useHealth = (): HealthInfo => useContext(HealthContext);
