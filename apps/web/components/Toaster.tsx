"use client";
/**
 * Minimal toasts for failures of background actions (downloads, exports) that shouldn't replace the
 * page. `toast(message)` from anywhere; one <Toaster /> is mounted in the dashboard shell.
 */
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/client/cn";

type Toast = { id: number; message: string; tone: "error" | "success" };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** `message` must be user copy (e.g. errorMessage(e)). */
export function toast(message: string, tone: Toast["tone"] = "error"): void {
  const id = nextId++;
  // Same message twice in a row (double click) → one toast.
  toasts = [...toasts.filter((t) => t.message !== message), { id, message, tone }].slice(-3);
  emit();
  setTimeout(() => dismissToast(id), 6000);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => toasts;
const serverSnapshot = (): Toast[] => [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border bg-card px-3 py-2.5 text-sm shadow-lg",
            t.tone === "error" ? "border-red-200 text-red-800" : "border-emerald-200 text-emerald-800",
          )}
        >
          {t.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span className="flex-1">{t.message}</span>
          <button type="button" onClick={() => dismissToast(t.id)} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
