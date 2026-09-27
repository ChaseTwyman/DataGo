export const THEME_STORAGE_KEY = "gt-theme";
export const RAIL_STORAGE_KEY = "gt-rail";

export type ThemeChoice = "light" | "dark";
export type RailChoice = "collapsed" | "expanded";

/** Below Tailwind's `lg` (1024px) the rail starts collapsed until the user chooses. */
const RAIL_COLLAPSED_QUERY = "(max-width: 1023px)";

/**
 * Blocking boot script for the root layout. Applies the stored theme and sidebar before first
 * paint. Storage keys are interpolated so they cannot drift from THEME_STORAGE_KEY / RAIL_STORAGE_KEY.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")d.dataset.theme=t;var r=localStorage.getItem(${JSON.stringify(RAIL_STORAGE_KEY)});if(r==="collapsed"||r==="expanded")d.dataset.rail=r;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d.dataset.theme==="light"?"#F4F6F8":"#000000");}catch(e){}})();`;

function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", document.documentElement.dataset.theme === "light" ? "#F4F6F8" : "#000000");
}

/** Re-apply stored choices. Hydration can reset attributes the boot script set. */
export function applyStoredPreferences(): void {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    const rail = localStorage.getItem(RAIL_STORAGE_KEY);
    if (rail === "collapsed" || rail === "expanded") document.documentElement.dataset.rail = rail;
  } catch {
    /* private mode or blocked storage */
  }
  syncThemeColor();
}

export function toggleTheme(): void {
  const next: ThemeChoice = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode or blocked storage */
  }
  syncThemeColor();
}

export function toggleRail(): void {
  const explicit = document.documentElement.dataset.rail;
  const collapsed = explicit === "collapsed" || (explicit !== "expanded" && window.matchMedia(RAIL_COLLAPSED_QUERY).matches);
  const next: RailChoice = collapsed ? "expanded" : "collapsed";
  document.documentElement.dataset.rail = next;
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, next);
  } catch {
    /* private mode or blocked storage */
  }
}
