import Link from "next/link";
import type { ShelfSummary } from "@/lib/shelf-model";
import { physicalLocationContext } from "@/lib/stock-model";

export function ShelfGrid({ shelf }: { shelf: ShelfSummary }) {
  return <div className="shelf-box-grid" aria-label={`Cajas de ${shelf.nombre}`}>
    {shelf.cajas.map(box => <Link key={box.id} href={`/estantes/${shelf.id}?caja=${box.id}`}
      className={`shelf-box ${box.ocupado ? "occupied" : "available"}`} data-location-id={box.id} data-position={box.posicion}>
      <strong className="shelf-box-code">{box.codigo}</strong>
      <small>{physicalLocationContext(box).split(" · ")[1]}</small>
      <span className={`sheet-status ${box.ocupado ? "occupied" : "available"}`}>{box.ocupado ? "Ocupado" : "Disponible"}</span>
      {box.ocupado && <span className="shelf-box-counts">{box.referencias} {box.referencias === 1 ? "referencia" : "referencias"} · {box.unidades.toLocaleString("es-CL")} unidades</span>}
    </Link>)}
  </div>;
}
