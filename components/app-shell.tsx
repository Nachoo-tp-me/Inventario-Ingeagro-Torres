"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  ChartNoAxesCombined,
  Clock3,
  Layers3,
  LogOut,
  PackageSearch,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "Inicio", icon: ChartNoAxesCombined },
  { href: "/torres", label: "Torres", icon: Layers3 },
  { href: "/productos", label: "Productos", icon: PackageSearch },
  { href: "/carga", label: "Carga rápida", mobileLabel: "Carga", icon: Zap },
  { href: "/historial", label: "Historial", icon: Clock3 },
];

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      className={mobile ? "mobile-navigation" : "side-navigation"}
      aria-label="Navegación principal"
    >
      {links.map(({ href, label, icon: Icon, ...rest }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "nav-link active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>{mobile && "mobileLabel" in rest ? rest.mobileLabel : label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    const { error } = await createSupabaseClient().auth.signOut();
    if (error) {
      console.error("No se pudo cerrar la sesión", error);
      setFailed(true);
      setPending(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      className={compact ? "signout compact" : "signout"}
      onClick={signOut}
      disabled={pending}
      type="button"
      title={
        failed ? "No se pudo cerrar sesión; intenta otra vez" : "Cerrar sesión"
      }
      aria-label="Cerrar sesión"
    >
      <LogOut aria-hidden="true" size={19} />
      {!compact && (
        <span>
          {pending
            ? "Saliendo…"
            : failed
              ? "Reintentar salida"
              : "Cerrar sesión"}
        </span>
      )}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link
          href="/"
          className="brand"
          aria-label="Inventario Ingeagro, ir a Inicio"
        >
          <span className="brand-mark">
            <Boxes size={25} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="brand-copy">
            <strong>INGEAGRO</strong>
            <small>INVENTARIO</small>
          </span>
        </Link>
        <div className="side-caption">ESPACIO DE TRABAJO</div>
        <Navigation />
        <div className="sidebar-foot">
          <div className="account-dot" aria-hidden="true" />
          <span>Cuenta Ingeagro</span>
          <SignOutButton compact />
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <Link
            href="/"
            className="mobile-brand"
            aria-label="Inventario Ingeagro, ir a Inicio"
          >
            <span className="brand-mark">
              <Boxes size={21} aria-hidden="true" />
            </span>
            <strong>INGEAGRO</strong>
          </Link>
          <div className="topbar-label">
            Inventario físico <span className="topbar-separator">/</span>{" "}
            Gestión de torres
          </div>
          <div className="topbar-right">
            <span className="session-pill">
              <span /> Sesión activa
            </span>
            <ThemeToggle />
            <SignOutButton compact />
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      <Navigation mobile />
    </div>
  );
}
