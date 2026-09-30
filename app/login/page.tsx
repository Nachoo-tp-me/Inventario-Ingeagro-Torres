import { Boxes, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { AUTHORIZED_USER_ID } from "@/lib/authorized-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ acceso?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub === AUTHORIZED_USER_ID) redirect("/");
  const { acceso } = await searchParams;

  return (
    <main className="login-page">
      <div className="login-side">
        <div className="login-side-inner">
          <div className="login-brand">
            <span className="brand-mark">
              <Boxes size={26} aria-hidden="true" />
            </span>
            <div>
              <strong>INGEAGRO</strong>
              <small>INVENTARIO</small>
            </div>
          </div>
          <div className="login-side-copy">
            <span className="hero-badge">
              <ShieldCheck size={15} aria-hidden="true" /> ACCESO SEGURO
            </span>
            <h1>
              Todo en su lugar.
              <br />
              Siempre a mano.
            </h1>
            <p>
              El inventario físico de Ingeagro, organizado para trabajar con
              claridad desde cualquier dispositivo.
            </p>
          </div>
          <div className="login-side-footer">
            CONTROL DE TORRES · INVENTARIO FÍSICO
          </div>
        </div>
        <div className="login-pattern" aria-hidden="true" />
      </div>
      <div className="login-form-side">
        <div className="login-theme-control">
          <ThemeToggle />
        </div>
        <div className="login-mobile-brand">
          <span className="brand-mark">
            <Boxes size={23} aria-hidden="true" />
          </span>
          <strong>INGEAGRO</strong>
        </div>
        <div className="login-card">
          <p className="eyebrow">BIENVENIDO</p>
          <h2>Inicia sesión</h2>
          <p className="login-intro">
            Accede con la cuenta compartida de Ingeagro.
          </p>
          <LoginForm denied={acceso === "denegado"} />
          <div className="login-card-foot">
            Acceso exclusivo al equipo de Ingeagro
          </div>
        </div>
      </div>
    </main>
  );
}
