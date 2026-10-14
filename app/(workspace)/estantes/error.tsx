"use client";

export default function ShelfError({ retry }: { retry: () => void }) {
  return <div className="error-panel" role="alert"><h2>No se pudieron cargar los estantes</h2>
    <p>Intenta nuevamente para consultar las ubicaciones y su contenido.</p>
    <button type="button" className="catalog-button" onClick={retry}>Reintentar</button></div>;
}
