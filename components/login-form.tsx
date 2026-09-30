"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { AUTHORIZED_USER_ID } from "@/lib/authorized-user";
import { createSupabaseClient } from "@/lib/supabase/client";

export function LoginForm({ denied = false }: { denied?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    denied ? "Esta cuenta no tiene acceso al inventario." : "",
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const supabase = createSupabaseClient();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.user) {
        if (error?.name === "AuthRetryableFetchError" || !navigator.onLine) {
          console.error("No hay conexión con Supabase Auth", error);
          setMessage("No hay conexión con el servicio. Inténtalo de nuevo.");
        } else {
          setMessage(
            "No pudimos iniciar sesión. Revisa el correo y la contraseña.",
          );
        }
        return;
      }
      if (data.user.id !== AUTHORIZED_USER_ID) {
        await supabase.auth.signOut();
        setMessage("Esta cuenta no tiene acceso al inventario.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Error de conexión durante el inicio de sesión", error);
      setMessage("No hay conexión con el servicio. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="email">Correo electrónico</label>
      <div className="field-wrap">
        <Mail size={19} aria-hidden="true" />
        <input
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Correo de Ingeagro"
          required
          disabled={pending}
        />
      </div>
      <label htmlFor="password">Contraseña</label>
      <div className="field-wrap">
        <LockKeyhole size={19} aria-hidden="true" />
        <input
          id="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Ingresa tu contraseña"
          required
          disabled={pending}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={
            showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
          }
        >
          {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {message && (
        <p className="login-message" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="login-submit" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar al inventario"}
        <ArrowRight size={19} aria-hidden="true" />
      </button>
    </form>
  );
}
