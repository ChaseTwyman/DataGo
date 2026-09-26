import type { LenientHealthResponse as HealthResponse, MockVariant } from "@groundtruth/shared";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type AuthMode = "supabase" | "dev";

interface AppState {
  ready: boolean;
  bootError: string | null;
  health: HealthResponse | null;
  authMode: AuthMode | null;
  userId: string | null;
  devToken: string | null;
  /** Dev-only: x-mock-variant sent on frame checks and submissions (mock mode demos). */
  mockVariant: MockVariant;
  onboarded: boolean;
  /** Last wallet balance seen, so the wallet can count up from it after a new credit. */
  lastSeenBalanceCents: number | null;
  setBoot: (p: Partial<Pick<AppState, "ready" | "bootError" | "health" | "authMode" | "userId" | "devToken">>) => void;
  setMockVariant: (v: MockVariant) => void;
  setOnboarded: (v: boolean) => void;
  setLastSeenBalance: (c: number) => void;
}

const K = { onboarded: "gt.onboarded", mock: "gt.mockVariant", devUser: "gt.devUserId" } as const;

export const useApp = create<AppState>((set) => ({
  ready: false,
  bootError: null,
  health: null,
  authMode: null,
  userId: null,
  devToken: null,
  mockVariant: "default",
  onboarded: false,
  lastSeenBalanceCents: null,
  setBoot: (p) => set(p),
  setMockVariant: (v) => {
    set({ mockVariant: v });
    void SecureStore.setItemAsync(K.mock, v);
  },
  setOnboarded: (v) => {
    set({ onboarded: v });
    void SecureStore.setItemAsync(K.onboarded, v ? "1" : "0");
  },
  setLastSeenBalance: (c) => set({ lastSeenBalanceCents: c }),
}));

export async function loadPersisted(): Promise<void> {
  const [onb, mock] = await Promise.all([SecureStore.getItemAsync(K.onboarded), SecureStore.getItemAsync(K.mock)]);
  const variants: MockVariant[] = ["default", "screen_recapture", "missing_element", "ai_generated", "error", "slow"];
  useApp.setState({
    onboarded: onb === "1",
    mockVariant: variants.includes(mock as MockVariant) ? (mock as MockVariant) : "default",
  });
}

export const devUserStore = {
  load: () => SecureStore.getItemAsync(K.devUser),
  save: (id: string) => SecureStore.setItemAsync(K.devUser, id),
};
