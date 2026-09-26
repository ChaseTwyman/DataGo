import { useEffect, useRef, useState } from "react";
import { countUpValue } from "../lib/feed";

/** Animates an integer (cents) from its previous value to `target`. */
export function useCountUp(target: number | null, durationMs = 1200, from?: number | null): number | null {
  const [value, setValue] = useState<number | null>(from ?? target);
  const prev = useRef<number | null>(from ?? null);
  useEffect(() => {
    if (target === null) return;
    const start = prev.current ?? 0;
    prev.current = target;
    if (start === target) {
      setValue(target);
      return;
    }
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const t = (Date.now() - t0) / durationMs;
      setValue(countUpValue(start, target, t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
