"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Package, Search, X } from "lucide-react";
import { submitStockOperation } from "@/app/(workspace)/stock-actions";
import {
  parseQuantity,
  validateStockOperation,
  type CompartmentOption,
  type ProductOption,
  type StockOperationInput,
  type StockOperationType,
} from "@/lib/stock-model";

export type StockOperationStart = {
  tipo: StockOperationType;
  productoId?: string;
  origenId?: number;
  destinoId?: number;
  currentStock?: number;
};

const TITLES: Record<StockOperationType, string> = {
  entrada: "Agregar stock",
  retiro: "Retirar stock",
  traslado: "Mover stock",
  ajuste: "Ajustar stock",
};

const subscribeToBrowser = () => () => {};

export function StockActionMenu({
  onSelect,
  showEntry = true,
}: {
  onSelect: (tipo: StockOperationType) => void;
  showEntry?: boolean;
}) {
  return (
    <details className="stock-action-menu">
      <summary>Acciones</summary>
      <div className="stock-action-options">
        {(["entrada", "retiro", "traslado", "ajuste"] as const)
          .filter((tipo) => showEntry || tipo !== "entrada")
          .map((tipo) => (
            <button key={tipo} type="button" onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onSelect(tipo);
            }}>{tipo === "entrada" ? "Agregar" : tipo === "retiro" ? "Retirar" : tipo === "traslado" ? "Mover" : "Ajustar"}</button>
          ))}
      </div>
    </details>
  );
}

export function StockOperationDialog({
  operation,
  products,
  compartments,
  onClose,
  onSuccess,
}: {
  operation: StockOperationStart;
  products: ProductOption[];
  compartments: CompartmentOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const router = useRouter();
  const isBrowser = useSyncExternalStore(subscribeToBrowser, () => true, () => false);
  const [productId, setProductId] = useState(operation.productoId ?? "");
  const [destinationId, setDestinationId] = useState<number | undefined>(operation.destinoId);
  const [productQuery, setProductQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [quantity, setQuantity] = useState(operation.tipo === "ajuste" ? String(operation.currentStock ?? 0) : "");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isBrowser) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [isBrowser]);

  const selectedProduct = products.find((item) => item.id === productId);
  const origin = compartments.find((item) => item.id === operation.origenId);
  const destination = compartments.find((item) => item.id === destinationId);
  const visibleProducts = products
    .filter((item) => `${item.nombre} ${item.categoria}`.toLocaleLowerCase("es").includes(productQuery.toLocaleLowerCase("es")))
    .slice(0, 50);
  const visibleLocations = compartments
    .filter((item) => item.id !== (operation.tipo === "traslado" ? operation.origenId : -1))
    .filter((item) => `${item.codigo} Torre C${item.torre_id} Piso ${item.piso}`.toLocaleLowerCase("es").includes(locationQuery.toLocaleLowerCase("es")))
    .slice(0, 50);

  function buildInput(): StockOperationInput | null {
    const value = parseQuantity(quantity, operation.tipo === "ajuste");
    if (value === null) {
      setError(operation.tipo === "ajuste"
        ? "La cantidad física debe ser un entero igual o mayor que cero."
        : "La cantidad debe ser un entero mayor que cero.");
      return null;
    }
    const input: StockOperationInput = {
      tipo: operation.tipo,
      productoId: productId,
      origenId: operation.origenId,
      destinoId: destinationId,
      ...(operation.tipo === "ajuste"
        ? { cantidadFisica: value, cantidadEsperada: operation.currentStock }
        : { cantidad: value }),
    };
    const validationError = validateStockOperation(input);
    if (validationError) { setError(validationError); return null; }
    if ((operation.tipo === "retiro" || operation.tipo === "traslado") &&
        operation.currentStock !== undefined && value > operation.currentStock) {
      setError("No hay stock suficiente en esta ubicación.");
      return null;
    }
    return input;
  }

  async function perform(input: StockOperationInput) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await submitStockOperation(input);
      if (!result.ok) {
        setConfirming(false);
        setError(result.message);
        return;
      }
      onSuccess(result.message);
      onClose();
      router.refresh();
    } catch {
      setConfirming(false);
      setError("No fue posible completar el movimiento. Inténtalo nuevamente.");
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = buildInput();
    if (!input) return;
    setError("");
    if (operation.tipo === "entrada" || confirming) {
      void perform(input);
    } else {
      setConfirming(true);
    }
  }

  const entered = parseQuantity(quantity, operation.tipo === "ajuste");
  const adjustmentDelta = operation.tipo === "ajuste" && entered !== null
    ? entered - (operation.currentStock ?? 0) : null;

  if (!isBrowser) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="stock-dialog"
      aria-labelledby="stock-dialog-title"
      onCancel={(event) => { if (pending) event.preventDefault(); else onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}
    >
      <div className="stock-dialog-inner">
        <header className="stock-dialog-header">
          <div><p className="eyebrow">MOVIMIENTO DE INVENTARIO</p><h2 id="stock-dialog-title">{TITLES[operation.tipo]}</h2></div>
          <button type="button" className="sheet-close" aria-label="Cerrar operación" onClick={onClose} disabled={pending}><X size={20} aria-hidden="true" /></button>
        </header>
        {confirming ? (
          <form onSubmit={handleSubmit} className="stock-confirmation">
            <p>Confirma antes de registrar este movimiento:</p>
            <strong>{operation.tipo === "ajuste"
              ? `Ajustar ${selectedProduct?.nombre ?? "producto"} de ${operation.currentStock} a ${entered} unidades`
              : `${TITLES[operation.tipo]}: ${quantity} unidades de ${selectedProduct?.nombre ?? "producto"}`}</strong>
            <div className="stock-confirm-route">
              {operation.tipo === "ajuste"
                ? <span>{origin?.codigo} · {adjustmentDelta === null ? "" : adjustmentDelta > 0 ? `+${adjustmentDelta}` : adjustmentDelta} unidades</span>
                : <><span>{origin?.codigo ?? "Inventario"}</span><ArrowRight size={18} aria-hidden="true" /><span>{destination?.codigo ?? "Salida"}</span></>}
            </div>
            {error && <p role="alert" className="catalog-message error">{error}</p>}
            <div className="stock-dialog-actions">
              <button type="button" className="catalog-quiet-button" disabled={pending} onClick={() => setConfirming(false)}>Volver</button>
              <button type="submit" className="catalog-button primary" disabled={pending}>{pending ? "Registrando…" : "Confirmar movimiento"}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="stock-form" noValidate>
            {operation.productoId ? (
              <div className="stock-fixed-choice"><Package size={18} aria-hidden="true" /><div><small>Producto</small><strong>{selectedProduct?.nombre ?? "Producto"}</strong></div></div>
            ) : (
              <div className="stock-picker">
                <label htmlFor="stock-product-search">Producto</label>
                <div className="stock-search-field"><Search size={18} aria-hidden="true" /><input id="stock-product-search" type="search" placeholder="Buscar por nombre" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} disabled={pending} autoFocus /></div>
                {selectedProduct && <p className="stock-picked"><Check size={16} aria-hidden="true" /> Seleccionado: {selectedProduct.nombre}</p>}
                <div className="stock-option-list" role="group" aria-label="Productos disponibles">
                  {visibleProducts.map((product) => <button key={product.id} type="button" className={product.id === productId ? "selected" : ""} aria-pressed={product.id === productId} onClick={() => setProductId(product.id)} disabled={pending}><Package size={17} aria-hidden="true" /><span><strong>{product.nombre}</strong><small>{product.categoria}</small></span></button>)}
                  {visibleProducts.length === 0 && <p>No se encontraron productos.</p>}
                </div>
                {products.length > 50 && <small className="stock-picker-hint">Escribe para encontrar otros productos.</small>}
              </div>
            )}

            {operation.origenId && <div className="stock-fixed-choice"><div><small>Ubicación de origen</small><strong>{origin?.codigo}</strong></div></div>}
            {operation.tipo === "ajuste" && <div className="stock-current"><span>Stock registrado</span><strong>{operation.currentStock?.toLocaleString("es-CL") ?? 0} unidades</strong></div>}
            {(operation.tipo === "entrada" || operation.tipo === "traslado") && (
              operation.destinoId ? (
                <div className="stock-fixed-choice"><div><small>Ubicación de destino</small><strong>{destination?.codigo}</strong></div></div>
              ) : (
                <div className="stock-picker">
                  <label htmlFor="stock-location-search">Ubicación de destino</label>
                  <div className="stock-search-field"><Search size={18} aria-hidden="true" /><input id="stock-location-search" type="search" placeholder="Ej. C264" value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} disabled={pending} /></div>
                  {destination && <p className="stock-picked"><Check size={16} aria-hidden="true" /> Seleccionado: {destination.codigo}</p>}
                  <div className="stock-option-list locations" role="group" aria-label="Ubicaciones disponibles">
                    {visibleLocations.map((item) => <button key={item.id} type="button" className={item.id === destinationId ? "selected" : ""} aria-pressed={item.id === destinationId} onClick={() => setDestinationId(item.id)} disabled={pending}><span><strong>{item.codigo}</strong><small>Torre C{item.torre_id} · Piso {item.piso} · Compartimiento {item.posicion}</small></span></button>)}
                    {visibleLocations.length === 0 && <p>No se encontraron ubicaciones.</p>}
                  </div>
                  {compartments.length > 50 && <small className="stock-picker-hint">Escribe el código para encontrar otras ubicaciones.</small>}
                </div>
              )
            )}

            <label className="catalog-field" htmlFor="stock-quantity">
              <span>{operation.tipo === "ajuste" ? "Cantidad física real" : "Cantidad de unidades"}</span>
              <input id="stock-quantity" type="text" inputMode="numeric" pattern="[0-9]*" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={operation.tipo === "ajuste" ? "Ej. 15" : "Ej. 7"} autoComplete="off" disabled={pending} />
            </label>
            {operation.tipo === "ajuste" && adjustmentDelta !== null && <p className="stock-delta">Variación: {adjustmentDelta > 0 ? "+" : ""}{adjustmentDelta.toLocaleString("es-CL")} unidades</p>}
            {(operation.tipo === "retiro" || operation.tipo === "traslado") && <p className="stock-available">Disponible en origen: {operation.currentStock?.toLocaleString("es-CL") ?? 0} unidades</p>}
            {error && <p role="alert" className="catalog-message error">{error}</p>}
            <div className="stock-dialog-actions">
              <button type="button" className="catalog-quiet-button" onClick={onClose} disabled={pending}>Cancelar</button>
              <button type="submit" className="catalog-button primary" disabled={pending}>{pending ? "Registrando…" : operation.tipo === "entrada" ? "Registrar entrada" : "Continuar"}</button>
            </div>
          </form>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
