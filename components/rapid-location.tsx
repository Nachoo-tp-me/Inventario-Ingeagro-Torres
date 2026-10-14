"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MapPin, Package, Plus, Search } from "lucide-react";
import { submitStockOperation } from "@/app/(workspace)/stock-actions";
import { ProductForm } from "@/components/product-form";
import { StockOperationDialog } from "@/components/stock-operation";
import { rapidLocationHref, rememberRapidLocation, type RapidAdjacent, type RapidLocationContent } from "@/lib/rapid-navigation-model";
import type { Category } from "@/lib/product-catalog";
import type { PhysicalLocationOption, ProductOption } from "@/lib/stock-model";
import { parseQuantity, physicalLocationContext } from "@/lib/stock-model";
import { searchLocationHref } from "@/lib/location-search-model";
import { matchesCatalogQuery } from "@/lib/rapid-model";

export function RapidLocation({ current, adjacent, products, categories, compartments }: {
  current: RapidLocationContent; adjacent: RapidAdjacent; products: ProductOption[];
  categories: Category[]; compartments: PhysicalLocationOption[];
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [mode, setMode] = useState<"list" | "select" | "new" | "quantity">("list");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjust, setAdjust] = useState<{ id: string; stock: number } | null>(null);
  useEffect(() => {
    try { rememberRapidLocation(localStorage, { id: current.id, tipo: current.tipo, codigo: current.codigo }); } catch { /* Preferencia local opcional. */ }
  }, [current.id, current.tipo, current.codigo]);

  const filtered = products.filter((item) => matchesCatalogQuery(item.nombre, item.categoria, query)).slice(0, 50);

  function choose(product: ProductOption) {
    setSelected(product); setQuantity(""); setError(""); setMode("quantity");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !selected) return;
    const amount = parseQuantity(quantity);
    if (amount === null) { setError("La cantidad debe ser un entero mayor que cero."); return; }
    busyRef.current = true; setPending(true); setError("");
    try {
      const result = await submitStockOperation({ tipo: "entrada", productoId: selected.id,
        destinoId: current.id, cantidad: amount });
      if (!result.ok) { setError(result.message); return; }
      setNotice(`${selected.nombre}: +${amount.toLocaleString("es-CL")} unidades registradas en ${current.codigo}.`);
      setMode("list"); setSelected(null); setQuantity(""); setQuery("");
      router.refresh();
    } catch {
      setError("No fue posible completar la entrada. Inténtalo nuevamente.");
    } finally { busyRef.current = false; setPending(false); }
  }

  const next = adjacent.next;
  const previous = adjacent.previous;
  return <div className="rapid-location-page">
    <Link className="back-link" href="/carga"><ArrowLeft size={18} aria-hidden="true" /> Elegir otra ubicación</Link>
    <header className="rapid-location-header">
      <p className="eyebrow">CARGA RÁPIDA · {current.tipo === "caja" ? `ESTANTE ${current.estante_id}` : `TORRE C${current.torre_id} · PISO ${current.piso}`}</p>
      <h1 style={{ overflowWrap: "anywhere" }}>{current.codigo}</h1>
      <p>{physicalLocationContext(current)}</p>
      <span className={current.ocupado ? "rapid-status occupied" : "rapid-status available"}>{current.ocupado ? "Ocupado" : "Disponible"}</span>
      <Link className="rapid-tower-link" href={searchLocationHref(current)}><MapPin size={17} aria-hidden="true" /> {current.tipo === "caja" ? "Ver en estante" : "Ver en torre"}</Link>
    </header>

    {notice && <p className="catalog-message success" role="status"><Check size={18} aria-hidden="true" /> {notice}</p>}

    <section className="rapid-content" aria-label="Contenido actual">
      <h2>Contenido actual</h2>
      {current.productos.length ? <div className="rapid-product-list">{current.productos.map((item) => <article key={item.id} className="rapid-product">
        <span className="rapid-product-photo">{item.fotoUrl ? (
          // URL firmada del bucket privado.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.fotoUrl} alt="" loading="lazy" />
        ) : <Package size={22} aria-hidden="true" />}</span>
        <span className="rapid-product-name"><strong>{item.nombre}</strong><small>{item.categoria}</small></span>
        <strong>{item.cantidad.toLocaleString("es-CL")}</strong>
        <button type="button" className="catalog-quiet-button" onClick={() => setAdjust({ id: item.id, stock: item.cantidad })}>Ajustar</button>
      </article>)}</div> : <p className="rapid-empty">Sin productos. Puedes continuar sin registrar stock.</p>}
    </section>

    {mode === "list" && <button type="button" className="catalog-button primary rapid-primary" onClick={() => { setNotice(""); setMode("select"); }}><Plus size={21} aria-hidden="true" /> {current.productos.length ? "Añadir otro producto" : "Añadir producto"}</button>}
    {mode === "select" && <section className="rapid-step" aria-label="Seleccionar producto">
      <div className="rapid-step-heading"><h2>Seleccionar producto</h2><button type="button" className="catalog-quiet-button" onClick={() => setMode("list")}>Cancelar</button></div>
      <label className="catalog-filter"><Search size={19} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre" aria-label="Buscar producto existente" autoComplete="off" autoFocus /></label>
      {filtered.length ? <div className="rapid-select-list">{filtered.map((item) => <button type="button" key={item.id} onClick={() => choose(item)}><Package size={22} aria-hidden="true" /><span><strong>{item.nombre}</strong><small>{item.categoria}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}</div> : <p className="search-empty">No encontramos productos.</p>}
      <button type="button" className="catalog-button rapid-create-button" onClick={() => { setError(""); setMode("new"); }}><Plus size={18} aria-hidden="true" /> Crear nuevo producto</button>
    </section>}
    {mode === "new" && <section className="rapid-step" aria-label="Crear producto durante la carga"><h2>Nuevo producto para {current.codigo}</h2>
      <ProductForm quick initialCategories={categories} onCancel={() => setMode("select")} onCreated={(product) => {
        choose(product);
        router.refresh();
      }} />
    </section>}
    {mode === "quantity" && selected && <section className="rapid-step" aria-label="Registrar cantidad">
      <h2>{selected.nombre}</h2><p>{selected.categoria} · Destino {current.codigo}</p>
      <form onSubmit={save}><label className="catalog-field">Cantidad<input type="text" inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={(event) => { setQuantity(event.target.value); setError(""); }} placeholder="Ej. 17" disabled={pending} autoFocus /></label>
        {error && <p className="catalog-message error" role="alert">{error}</p>}
        <div className="rapid-step-actions"><button type="button" className="catalog-quiet-button" onClick={() => setMode("select")} disabled={pending}>Cambiar producto</button><button type="submit" className="catalog-button primary" disabled={pending}>{pending ? "Guardando…" : `Guardar entrada en ${current.codigo}`}</button></div>
      </form>
    </section>}

    <nav className="rapid-neighbors" aria-label="Recorrido físico">
      {previous && <Link href={rapidLocationHref(previous)} className="catalog-button" style={{ overflowWrap: "anywhere" }}><ArrowLeft size={18} aria-hidden="true" /> Anterior · {previous.codigo}</Link>}
      {next && <Link href={rapidLocationHref(next)} className="catalog-button" style={{ overflowWrap: "anywhere" }}>{next.tipo === "caja" ? `${current.tipo === "caja" && next.estante_id !== current.estante_id ? `Pasar a Estante ${next.estante_id}` : "Siguiente"} · ${next.codigo}` : current.tipo === "compartimiento" && next.torre_id === current.torre_id ? `Siguiente · ${next.codigo}` : `Pasar a Torre C${next.torre_id} · ${next.codigo}`} <ArrowRight size={18} aria-hidden="true" /></Link>}
    </nav>
    {adjust && <StockOperationDialog operation={{ tipo: "ajuste", productoId: adjust.id, origenId: current.id, currentStock: adjust.stock }}
      products={products} locations={compartments} onClose={() => setAdjust(null)} onSuccess={(message) => { setNotice(message); router.refresh(); }} />}
  </div>;
}
