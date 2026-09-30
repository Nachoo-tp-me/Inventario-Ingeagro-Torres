"use client";

import { useEffect, useRef } from "react";
import { Boxes, Check, MapPin, Package, X } from "lucide-react";
import type { TowerCompartment } from "@/lib/tower-model";

export function CompartmentDetail({
  compartment,
  towerCode,
  onClose,
}: {
  compartment: TowerCompartment | null;
  towerCode: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (compartment && !dialog.open) dialog.showModal();
    if (!compartment && dialog.open) dialog.close();
  }, [compartment]);

  useEffect(() => {
    if (!compartment) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [compartment]);

  return (
    <dialog
      ref={dialogRef}
      className="compartment-dialog"
      aria-labelledby="compartment-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
              onClick={onClose}
              aria-label="Cerrar detalle de compartimiento"
              autoFocus
            >
              <X size={21} aria-hidden="true" />
            </button>
          </header>

          <div className="sheet-location">
            <MapPin size={18} aria-hidden="true" />
            <span>Torre {towerCode}</span>
            <span className="sheet-separator">·</span>
            <span>Piso {compartment.piso}</span>
            <span className="sheet-separator">·</span>
            <span>Compartimiento {compartment.posicion}</span>
          </div>

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

          {compartment.ocupado ? (
            <section
              className="sheet-products"
              aria-label="Productos en el compartimiento"
            >
              <h3>Contenido</h3>
              <div className="sheet-product-list">
                {compartment.productos.map((product) => (
                  <article className="sheet-product" key={product.id}>
                    <div className="product-photo">
                      {product.fotoUrl ? (
                        // El origen está limitado a las fotos públicas del proyecto Supabase.
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
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <div className="sheet-empty">
              <div className="sheet-empty-icon">
                <Package size={27} aria-hidden="true" />
              </div>
              <h3>Compartimiento disponible</h3>
              <p>Esta ubicación no contiene productos por ahora.</p>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
