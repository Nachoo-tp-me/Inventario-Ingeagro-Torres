"use client";

import { useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { StockActionMenu, StockOperationDialog, type StockOperationStart } from "@/components/stock-operation";
import type { ProductLocation } from "@/lib/product-catalog";
import type { CompartmentOption, ProductOption } from "@/lib/stock-model";

export function ProductStockControls({
  product,
  locations,
  compartments,
}: {
  product: ProductOption;
  locations: ProductLocation[];
  compartments: CompartmentOption[];
}) {
  const [operation, setOperation] = useState<StockOperationStart | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <section className="catalog-locations" aria-labelledby="catalog-locations-title">
      <div className="catalog-section-heading">
        <div><p className="eyebrow">INVENTARIO</p><h2 id="catalog-locations-title">Ubicaciones actuales</h2></div>
        <button type="button" className="catalog-button primary" onClick={() => setOperation({ tipo: "entrada", productoId: product.id })}><Plus size={17} aria-hidden="true" /> Agregar stock</button>
      </div>
      {notice && <p className="catalog-message success stock-page-notice" role="status">{notice}</p>}
      {locations.length === 0 ? (
        <div className="catalog-no-stock"><MapPin size={24} aria-hidden="true" /><p>Sin stock asignado</p></div>
      ) : (
        <ul className="catalog-location-list">
          {locations.map((location) => (
            <li key={location.id}>
              <div className="stock-location-main">
                <span><MapPin size={18} aria-hidden="true" /> {location.codigo}</span>
                <strong>{location.cantidad.toLocaleString("es-CL")} unidades</strong>
              </div>
              <div className="stock-location-actions">
                <StockActionMenu showEntry={false} onSelect={(tipo) => {
                  setNotice("");
                  setOperation({ tipo, productoId: product.id, origenId: location.id, currentStock: location.cantidad });
                }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {operation && (
        <StockOperationDialog
          key={`${operation.tipo}-${operation.origenId ?? "new"}`}
          operation={operation}
          products={[product]}
          compartments={compartments}
          onClose={() => setOperation(null)}
          onSuccess={setNotice}
        />
      )}
    </section>
  );
}
