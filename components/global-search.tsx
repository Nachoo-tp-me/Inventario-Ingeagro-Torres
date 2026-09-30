"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin, Package, Search } from "lucide-react";
import { searchInventory, type SearchResult } from "@/app/(workspace)/search-actions";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    if (!query.trim()) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const found = await searchInventory(query);
        if (sequence.current === current) setResult(found);
      } catch {
        if (sequence.current === current) setError(true);
      } finally {
        if (sequence.current === current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return <section className="global-search" aria-label="Búsqueda global">
    <div className="search-preview">
      <Search size={22} aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setResult(null); setLoading(false); setError(false); }}
        placeholder="Producto, categoría o C264" aria-label="Buscar producto, categoría o ubicación"
        autoComplete="off" maxLength={100} />
      {loading && <span className="search-feedback" role="status">Buscando…</span>}
    </div>
    {query.trim() && <div className="global-search-results" aria-live="polite">
      {error ? <p className="catalog-message error" role="alert">No pudimos buscar. Inténtalo nuevamente.</p> : result && !loading ? <>
        {result.location && <Link className="global-location-result" href={`/torres/${result.location.torre}?compartimiento=${result.location.codigo}`}>
          <MapPin size={24} aria-hidden="true" />
          <span><strong>{result.location.codigo}</strong><small>Torre {result.location.torre} · Piso {result.location.piso} · Compartimiento {result.location.posicion}</small>
            <small>{result.location.productos.length ? `Ocupado · ${result.location.productos.map((item) => `${item.nombre} ${item.cantidad}`).join(" · ")}` : "Disponible · Sin productos"}</small></span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>}
        {result.locationAttempt && !result.location && <p className="search-empty">No encontramos esa ubicación.</p>}
        {result.products.length > 0 && <div className="search-product-list">{result.products.map((item) => <Link className="search-product-result" key={item.id} href={`/productos/${item.id}`}>
          <span className="search-result-photo">{item.fotoUrl ? (
            // URL firmada del bucket privado.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.fotoUrl} alt="" loading="lazy" />
          ) : <Package size={24} aria-hidden="true" />}</span>
          <span className="search-result-copy"><strong>{item.nombre}</strong><small>{item.categoria} · {item.stock} unidades · {item.ubicaciones} {item.ubicaciones === 1 ? "ubicación" : "ubicaciones"}</small>
            {item.principales.length > 0 && <small>{item.principales.map((place) => `${place.codigo} — ${place.cantidad}`).join(" · ")}</small>}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>)}</div>}
        {!result.products.length && !result.location && !result.locationAttempt && <p className="search-empty">No encontramos productos. <Link href="/productos/nuevo">Crear nuevo producto</Link></p>}
      </> : null}
    </div>}
  </section>;
}
