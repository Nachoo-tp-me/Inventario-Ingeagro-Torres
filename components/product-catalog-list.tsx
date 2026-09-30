"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Package, Plus, Search } from "lucide-react";
import type { Product } from "@/lib/product-catalog";
import { matchesCatalogQuery } from "@/lib/rapid-model";

export function ProductCatalogList({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => products.filter((item) => matchesCatalogQuery(item.nombre, item.categoria, query)), [products, query]);
  if (!products.length) return <div className="catalog-empty">
    <span className="catalog-empty-icon"><Package size={34} aria-hidden="true" /></span>
    <h2>Aún no hay productos registrados</h2>
    <p>Agrega el primero para empezar a organizar el catálogo de Ingeagro.</p>
    <Link href="/productos/nuevo" className="catalog-button primary"><Plus size={19} aria-hidden="true" /> Agregar producto</Link>
  </div>;
  return <>
    <label className="catalog-filter"><Search size={20} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por nombre o categoría" aria-label="Filtrar productos por nombre o categoría" autoComplete="off" /></label>
    <p className="catalog-count">{visible.length.toLocaleString("es-CL")} {visible.length === 1 ? "producto" : "productos"}{query.trim() ? " encontrados" : " registrados"}</p>
    {!visible.length ? <div className="catalog-empty compact"><Package size={30} aria-hidden="true" /><h2>No encontramos productos</h2><p>Prueba otro nombre o categoría.</p><Link href="/productos/nuevo" className="catalog-button primary"><Plus size={18} aria-hidden="true" /> Crear nuevo producto</Link></div> : <div className="catalog-grid">
      {visible.map((product) => <Link href={`/productos/${product.id}`} className="catalog-card" key={product.id}>
        <div className="catalog-card-photo">{product.fotoUrl ? (
          // URL firmada del bucket privado.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.fotoUrl} alt="" loading="lazy" />
        ) : <Package size={38} aria-hidden="true" />}</div>
        <div className="catalog-card-content"><span className="catalog-category">{product.categoria}</span><h2>{product.nombre}</h2><p>{product.descripcion || "Sin descripción"}</p>
          <div className="catalog-card-foot"><strong>{product.stock.toLocaleString("es-CL")} <small>unid.</small></strong><span><MapPin size={15} aria-hidden="true" /> {product.ubicaciones} {product.ubicaciones === 1 ? "ubicación" : "ubicaciones"}</span></div>
        </div>
      </Link>)}
    </div>}
  </>;
}
