"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  ChartNoAxesCombined,
  Clock3,
  Download,
  Layers3,
  LogOut,
  PackageSearch,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { createSupabaseClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DESKTOP_LINKS,
  MOBILE_LINKS,
  isDesktopActive,
  isMobileActive,
  sectionLabel,
} from "@/lib/navigation-model";

const ICONS = {
  "/": ChartNoAxesCombined,
  "/torres": Layers3,
  "/estantes": Boxes,
  "/ubicaciones": Layers3,
  "/productos": PackageSearch,
  "/carga": Zap,
  "/historial": Clock3,
  "/exportaciones": Download,
} as const;

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = mobile ? isMobileActive : isDesktopActive;
  return (
    <nav
      className={mobile ? "mobile-navigation" : "side-navigation"}
      aria-label="Navegación principal"
    >
      {(mobile ? MOBILE_LINKS : DESKTOP_LINKS).map(({ href, label, mobileLabel }) => {
        const Icon = ICONS[href as keyof typeof ICONS];
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "nav-link active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>{mobile && mobileLabel ? mobileLabel : label}</span>
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

function TopbarContext() {
  const pathname = usePathname();
  return (
    <div className="topbar-label">
      <span className="topbar-system">Inventario físico</span>
      <span className="topbar-separator" aria-hidden="true">/</span>
      <span className="topbar-section">{sectionLabel(pathname)}</span>
    </div>
  );
}

function ExportShortcut() {
  const pathname = usePathname();
  const active = isDesktopActive(pathname, "/exportaciones");
  return (
    <Link
      href="/exportaciones"
      className={active ? "topbar-export active" : "topbar-export"}
      aria-label="Exportar inventario"
      aria-current={active ? "page" : undefined}
      title="Exportar inventario"
    >
      <Download aria-hidden="true" size={20} />
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
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
          <TopbarContext />
          <div className="topbar-right">
            <span className="session-pill">
              <span /> Sesión activa
            </span>
            <ExportShortcut />
            <ThemeToggle />
            <SignOutButton compact />
          </div>
        </header>
        <main id="contenido" tabIndex={-1} className="main-content">{children}</main>
      </div>
      <Navigation mobile />
    </div>
  );
}
