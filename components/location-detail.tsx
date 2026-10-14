"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Boxes, Check, MapPin, Package, Plus, X } from "lucide-react";
import type { LocationContent } from "@/lib/location-content";
import type { PhysicalLocationOption, ProductOption } from "@/lib/stock-model";
import { StockActionMenu, StockOperationDialog, type StockOperationStart } from "@/components/stock-operation";

export function LocationDetail({
  compartment,
  context,
  kind,
  quickLoadHref,
  compartments,
  products,
  onClose,
}: {
  compartment: LocationContent | null;
  context: React.ReactNode;
  kind: "caja" | "compartimiento";
  quickLoadHref?: string;
  compartments: PhysicalLocationOption[];
  products: ProductOption[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [operation, setOperation] = useState<StockOperationStart | null>(null);
  const [notice, setNotice] = useState("");
  const locationId = compartment?.id;

  function closeSheet() {
    setOperation(null);
    setNotice("");
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || locationId === undefined) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [locationId]);

  return (
    <dialog
      ref={dialogRef}
      className={kind === "caja" ? "compartment-dialog box-dialog" : "compartment-dialog"}
      aria-labelledby="compartment-dialog-title"
      onClose={(event) => {
        if (event.target === event.currentTarget && !event.currentTarget.open && event.currentTarget.isConnected) closeSheet();
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        closeSheet();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeSheet();
      }}
    >
      {compartment && (
        <div className="detail-sheet">
          <div className="sheet-handle" aria-hidden="true" />
          <header className="sheet-header">
            <div>
              <p className="eyebrow">DETALLE DE UBICACIÓN</p>
              <h2 id="compartment-dialog-title">{compartment.codigo}</h2>
            </div>
            <button
              type="button"
              className="sheet-close"
              onClick={closeSheet}
              aria-label={`Cerrar detalle de ${kind}`}
              autoFocus
            >
              <X size={21} aria-hidden="true" />
            </button>
          </header>

          <div className="sheet-location">
            <MapPin size={18} aria-hidden="true" />
            {context}
          </div>
          {quickLoadHref && <Link className="catalog-button rapid-sheet-link" href={quickLoadHref}><Plus size={17} aria-hidden="true" /> Cargar aquí</Link>}

          <div
            className={`sheet-status ${compartment.ocupado ? "occupied" : "available"}`}
          >
            {compartment.ocupado ? (
              <Boxes size={20} aria-hidden="true" />
            ) : (
              <Check size={20} aria-hidden="true" />
            )}
            <div>
              <strong>{compartment.ocupado ? "Ocupado" : "Disponible"}</strong>
              <span>
                {compartment.ocupado
                  ? `${compartment.productos.length} ${compartment.productos.length === 1 ? "producto" : "productos"} con stock positivo`
                  : "Sin productos con stock positivo"}
              </span>
            </div>
          </div>

          {notice && <p className="catalog-message success" role="status">{notice}</p>}

          {compartment.ocupado ? (
            <section
              className="sheet-products"
              aria-label={`Productos en ${kind === "caja" ? "la caja" : "el compartimiento"}`}
            >
              <h3>Contenido</h3>
              <div className="sheet-product-list">
                {compartment.productos.map((product) => (
                  <article className="sheet-product" key={product.id}>
                    <div className="product-photo">
                      {product.fotoUrl ? (
                        // URL firmada del bucket privado.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.fotoUrl} alt="" loading="lazy" />
                      ) : (
                        <Package size={22} aria-hidden="true" />
                      )}
                    </div>
                    <div className="product-copy">
                      <strong>{product.nombre}</strong>
                      <span>{product.categoria}</span>
                    </div>
                    <div
                      className="product-quantity"
                      aria-label={`Cantidad: ${product.cantidad}`}
                    >
                      <strong>
                        {product.cantidad.toLocaleString("es-CL")}
                      </strong>
                      <span>unid.</span>
                    </div>
                    <StockActionMenu onSelect={(tipo) => {
                      setNotice("");
                      setOperation({
                        tipo,
                        productoId: product.id,
                        origenId: tipo === "entrada" ? undefined : compartment.id,
                        destinoId: tipo === "entrada" ? compartment.id : undefined,
                        currentStock: product.cantidad,
                      });
                    }} />
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <div className="sheet-empty">
              <div className="sheet-empty-icon">
                <Package size={27} aria-hidden="true" />
              </div>
              <h3>{kind === "caja" ? "Caja disponible" : "Compartimiento disponible"}</h3>
              <p>Esta ubicación no contiene productos por ahora.</p>
              <button type="button" className="catalog-button primary sheet-stock-add" onClick={() => {
                setNotice("");
                setOperation({ tipo: "entrada", destinoId: compartment.id });
              }}><Plus size={18} aria-hidden="true" /> Agregar producto</button>
            </div>
          )}
          {compartment.ocupado && <button type="button" className="catalog-button sheet-stock-add" onClick={() => {
            setNotice("");
            setOperation({ tipo: "entrada", destinoId: compartment.id });
          }}><Plus size={17} aria-hidden="true" /> Agregar otro producto</button>}
          {operation && (
            <StockOperationDialog
              key={`${operation.tipo}-${operation.productoId ?? "select"}`}
              operation={operation}
              products={products}
              locations={compartments}
              onClose={() => setOperation(null)}
              onSuccess={setNotice}
            />
          )}
        </div>
      )}
    </dialog>
  );
}
