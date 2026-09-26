"use client";
import { Check, LoaderCircle } from "lucide-react";
import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/** Square checkbox with its label; the native input stays for keyboard, forms and screen readers. */
export function Checkbox({
  label,
  className,
  id,
  ...p
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label htmlFor={inputId} className={cn("group flex cursor-pointer items-start gap-2.5 text-sm leading-snug", p.disabled && "cursor-not-allowed opacity-50", className)}>
      <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <input
          id={inputId}
          type="checkbox"
          className="peer absolute inset-0 size-4 cursor-pointer appearance-none rounded-[2px] border border-input bg-background transition-colors checked:border-primary checked:bg-primary disabled:cursor-not-allowed"
          {...p}
        />
        <Check className="pointer-events-none relative size-3 text-primary-foreground opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden />
      </span>
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** On/off switch (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  tone = "default",
  busy = false,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  /** Accessible name. */
  label: string;
  tone?: "default" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          checked ? (tone === "danger" ? "border-destructive bg-destructive" : "border-primary bg-primary") : "border-input bg-secondary",
        )}
      >
        <span
          className={cn(
            "inline-block size-3.5 rounded-full transition-transform",
            checked ? "translate-x-[18px] bg-black" : "translate-x-[2px] bg-muted-foreground",
          )}
        />
      </button>
      {busy ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
    </span>
  );
}

/** Range input styled as a thin rule with an accent thumb; shows its value as a readout. */
export function Slider({ className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="range"
      className={cn(
        "h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50",
        "[&::-webkit-slider-runnable-track]:h-px [&::-webkit-slider-runnable-track]:bg-input",
        "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:bg-primary",
        "[&::-moz-range-track]:h-px [&::-moz-range-track]:bg-input [&::-moz-range-thumb]:size-[15px] [&::-moz-range-thumb]:rounded-[2px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
        className,
      )}
      {...p}
    />
  );
}

/**
 * Segmented tabs (role="tablist"). Arrow keys move between tabs. Controlled: pass `value`/`onChange`.
 * Used for filters and small mode switches; the panel itself is rendered by the caller.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  items: readonly { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + items.length) % items.length;
    const next = items[n];
    if (next) {
      onChange(next.id);
      refs.current[n]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex items-stretch border-b", className)}>
      {items.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "caps relative -mb-px cursor-pointer border-b-2 font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "px-2.5 py-2 text-[11px]" : "px-3.5 py-2.5 text-xs",
              on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 text-muted-foreground tabular-nums">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
