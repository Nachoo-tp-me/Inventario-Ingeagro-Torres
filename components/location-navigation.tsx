"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Layers3 } from "lucide-react";
import { matchesSegment } from "@/lib/navigation-model";

const OPTIONS = [
  { href: "/torres", label: "Torres", icon: Layers3 },
  { href: "/estantes", label: "Estantes", icon: Boxes },
];

export function LocationNavigation() {
  const pathname = usePathname();
  return <nav className="location-navigation" aria-label="Tipos de ubicación">
    {OPTIONS.map(({ href, label, icon: Icon }) =>
      <Link key={href} href={href} className="catalog-button" aria-current={matchesSegment(pathname, href) ? "page" : undefined}>
        <Icon size={18} aria-hidden="true" />{label}
      </Link>)}
  </nav>;
}
