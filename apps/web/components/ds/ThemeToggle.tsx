"use client";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { toggleTheme } from "./preferences";

/** Icon button: sun while the page is dark (switch to light), moon while it is light. */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "relative inline-flex size-9 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Sun className="theme-when-dark size-4" strokeWidth={1.5} aria-hidden />
      <Moon className="theme-when-light size-4" strokeWidth={1.5} aria-hidden />
      <span className="theme-when-dark sr-only">Switch to light mode</span>
      <span className="theme-when-light sr-only">Switch to dark mode</span>
    </button>
  );
}
