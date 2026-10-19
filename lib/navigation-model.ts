// Presentation-only helpers for the app shell: they never touch routes, auth or data.

export type NavigationLink = { href: string; label: string; mobileLabel?: string };

export const DESKTOP_LINKS: NavigationLink[] = [
  { href: "/", label: "Inicio" },
  { href: "/torres", label: "Torres" },
  { href: "/estantes", label: "Estantes" },
  { href: "/productos", label: "Productos" },
  { href: "/carga", label: "Carga rápida" },
  { href: "/historial", label: "Historial" },
  { href: "/exportaciones", label: "Exportaciones" },
];

// Five mobile destinations; Torres/Estantes are grouped under Ubicaciones and
// Exportaciones is reached from the topbar icon, never as a sixth tab.
export const MOBILE_LINKS: NavigationLink[] = [
  { href: "/", label: "Inicio" },
  { href: "/productos", label: "Productos" },
  { href: "/ubicaciones", label: "Ubicaciones" },
  { href: "/carga", label: "Carga rápida", mobileLabel: "Carga" },
  { href: "/historial", label: "Historial" },
];

const LOCATION_SEGMENTS = ["/ubicaciones", "/torres", "/estantes"];

/** True when pathname is the route itself or one of its real sub-routes ("/torres" ≠ "/torresX"). */
export function matchesSegment(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop: each entry matches only its own section; "/ubicaciones" has no desktop entry. */
export function isDesktopActive(pathname: string, href: string): boolean {
  return matchesSegment(pathname, href);
}

/** Mobile: "Ubicaciones" groups /ubicaciones, /torres and /estantes with their sub-routes. */
export function isMobileActive(pathname: string, href: string): boolean {
  if (href === "/ubicaciones") return LOCATION_SEGMENTS.some(segment => matchesSegment(pathname, segment));
  return matchesSegment(pathname, href);
}

const SECTION_LABELS: [string, string][] = [
  ["/torres", "Torres"],
  ["/estantes", "Estantes"],
  ["/ubicaciones", "Ubicaciones"],
  ["/productos", "Productos"],
  ["/carga", "Carga rápida"],
  ["/historial", "Historial"],
  ["/exportaciones", "Exportaciones"],
];

/** Contextual topbar section; unknown routes fall back to the general name. */
export function sectionLabel(pathname: string): string {
  if (pathname === "/") return "Inicio";
  return SECTION_LABELS.find(([href]) => matchesSegment(pathname, href))?.[1] ?? "Inventario";
}
