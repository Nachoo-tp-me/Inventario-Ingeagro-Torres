"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LocationNavigation() {
  const pathname = usePathname();
  return <nav className="location-navigation" aria-label="Tipos de ubicación">
    {[["/torres", "Torres"], ["/estantes", "Estantes"]].map(([href, label]) =>
      <Link key={href} href={href} className="catalog-button" aria-current={pathname.startsWith(href) ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
