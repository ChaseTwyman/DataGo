/** Dashboard gating (pure, unit-tested). The server enforces permissions; this only picks the screen. */
/** Pages a signed-in account may open without researcher access. */
export function allowedWithoutResearcher(pathname: string, isAdmin: boolean): boolean {
  if (pathname === "/account" || pathname.startsWith("/account/")) return true;
  if (isAdmin && (pathname === "/admin" || pathname.startsWith("/admin/"))) return true;
  return false;
}
