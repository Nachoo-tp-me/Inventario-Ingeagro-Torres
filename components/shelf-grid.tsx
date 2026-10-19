import { Fragment } from "react";
import Link from "next/link";
import { Check, Package } from "lucide-react";
import type { ShelfSummary } from "@/lib/shelf-model";
import { physicalLocationContext } from "@/lib/stock-model";

// Break opportunities after "_" and "-" only; <wbr> adds no text, so textContent,
// the accessible name and copied text stay identical to the stored code.
export function BoxCode({ code }: { code: string }) {
  const parts = code.match(/[^_-]*[_-]|[^_-]+$/g) ?? [code];
  return parts.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>);
}

export const SHELF_STATUS_HELP = "Disponible: sin stock positivo. La posición física permanece al cambiar el código.";

function plural(count: number, singular: string, pluralForm: string) {
  return `${count.toLocaleString("es-CL")} ${count === 1 ? singular : pluralForm}`;
}

export function ShelfGrid({ shelf, selectedId = null }: { shelf: ShelfSummary; selectedId?: number | null }) {
  return <div className="shelf-box-grid" aria-label={`Cajas de ${shelf.nombre}`}>
    {shelf.cajas.map(box => <Link key={box.id} href={`/estantes/${shelf.id}?caja=${box.id}`}
      className={`shelf-box ${box.ocupado ? "occupied" : "available"}${box.id === selectedId ? " selected" : ""}`}
      aria-current={box.id === selectedId ? "location" : undefined} data-location-id={box.id} data-position={box.posicion}>
      <strong className="shelf-box-code"><BoxCode code={box.codigo} /></strong>
      <small>{physicalLocationContext(box).split(" · ")[1]}</small>
      <span className={`sheet-status ${box.ocupado ? "occupied" : "available"}`}>
        {box.ocupado ? <Package size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        {box.ocupado ? "Ocupado" : "Disponible"}
      </span>
      <span className="shelf-box-counts">{box.ocupado
        ? `${plural(box.referencias, "referencia", "referencias")} · ${plural(box.unidades, "unidad", "unidades")}`
        : "0 unidades"}</span>
    </Link>)}
  </div>;
}
