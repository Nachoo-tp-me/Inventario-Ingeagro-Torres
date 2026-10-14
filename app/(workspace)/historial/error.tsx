"use client";

export default function HistoryError({ retry }: { retry: () => void }) {
  return <div className="error-panel" role="alert"><h2>No se pudo cargar el historial</h2>
    <p>Intenta nuevamente para consultar los movimientos registrados.</p>
    <button type="button" className="catalog-button" onClick={retry}>Reintentar</button></div>;
}
