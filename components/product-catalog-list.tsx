"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Package, Plus, Search } from "lucide-react";
import { ProductThumb } from "@/components/product-photo";
import type { Product } from "@/lib/product-catalog";
import { locationsLabel, unitsLabel } from "@/lib/product-presentation";
import { matchesCatalogQuery } from "@/lib/rapid-model";

export function ProductCatalogList({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => products.filter((item) => matchesCatalogQuery(item.nombre, item.categoria, query)), [products, query]);
  if (!products.length) return <div className="catalog-empty">
    <span className="catalog-empty-icon"><Package size={34} aria-hidden="true" /></span>
    <h2>Aún no hay productos registrados</h2>
    <p>Crea el primero para empezar a organizar el catálogo de Ingeagro.</p>
    <Link href="/productos/nuevo" className="catalog-button primary"><Plus size={19} aria-hidden="true" /> Crear producto</Link>
  </div>;
  return <>
    <label className="catalog-filter"><Search size={20} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por nombre o categoría" aria-label="Filtrar productos por nombre o categoría" autoComplete="off" /></label>
    <p className="catalog-count">{visible.length.toLocaleString("es-CL")} {visible.length === 1 ? "producto" : "productos"}{query.trim() ? " encontrados" : " registrados"}</p>
    {!visible.length ? <div className="catalog-empty compact"><Package size={30} aria-hidden="true" /><h2>No encontramos productos</h2><p>Prueba otro nombre o categoría.</p><Link href="/productos/nuevo" className="catalog-button primary"><Plus size={18} aria-hidden="true" /> Crear producto</Link></div> : <div className="catalog-grid">
      {visible.map((product) => <Link href={`/productos/${product.id}`} className={product.stock > 0 ? "catalog-card" : "catalog-card no-stock"} key={product.id}>
        <ProductThumb url={product.fotoUrl} />
        <span className="catalog-card-main">
          <h2>{product.nombre}</h2>
          <span className="catalog-category">{product.categoria}</span>
        </span>
        <span className="catalog-card-meta">
          <strong className="catalog-card-units">{unitsLabel(product.stock)}</strong>
          <span className="catalog-card-locations"><MapPin size={14} aria-hidden="true" /> {locationsLabel(product.ubicaciones)}</span>
        </span>
        <ChevronRight className="catalog-card-chevron" size={18} aria-hidden="true" />
      </Link>)}
    </div>}
  </>;
}
