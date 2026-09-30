"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggleTheme() {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("ingeagro-theme", nextTheme);
    } catch {
      // El tema sigue funcionando si el navegador bloquea el almacenamiento.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label="Cambiar entre modo claro y modo oscuro"
      title="Cambiar entre modo claro y modo oscuro"
    >
      <Moon className="theme-icon-dark" size={18} aria-hidden="true" />
      <Sun className="theme-icon-light" size={18} aria-hidden="true" />
      <span className="theme-label-dark">Modo oscuro</span>
      <span className="theme-label-light">Modo claro</span>
    </button>
  );
}
