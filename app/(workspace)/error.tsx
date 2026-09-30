"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error al cargar el inventario", error);
  }, [error]);
  return (
    <div className="error-panel" role="alert">
      <AlertCircle size={30} aria-hidden="true" />
      <h2>No pudimos cargar el inventario</h2>
      <p>Comprueba tu conexión e inténtalo de nuevo.</p>
      <button type="button" onClick={reset} className="primary-button">
        Reintentar
      </button>
    </div>
  );
}
