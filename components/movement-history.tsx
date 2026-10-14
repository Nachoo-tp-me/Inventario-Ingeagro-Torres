import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { historyLocationLabel, type HistoryEntry, type HistoryLocation } from "@/lib/history-model";
import { searchLocationHref } from "@/lib/location-search-model";
import { physicalLocationContext } from "@/lib/stock-model";

const ICONS = { entrada: ArrowDownLeft, retiro: ArrowUpRight, traslado: ArrowLeftRight, ajuste: SlidersHorizontal };

function LocationReference({ location }: { location: HistoryLocation | null }) {
  if (!location) return <>—</>;
  const label = historyLocationLabel(location);
  return location.ubicacionActual
    ? <Link className="text-link history-location-link" href={searchLocationHref(location.ubicacionActual)} title={physicalLocationContext(location.ubicacionActual)}>{label}</Link>
    : <span>{label}</span>;
}

function movementText(entry: HistoryEntry) {
  const quantity = entry.cantidad.toLocaleString("es-CL");
  if (entry.tipo === "entrada") return <>+{quantity} {entry.producto} → <LocationReference location={entry.destino} /></>;
  if (entry.tipo === "retiro") return <>−{quantity} {entry.producto} ← <LocationReference location={entry.origen} /></>;
  if (entry.tipo === "traslado") return <>{quantity} {entry.producto} · <LocationReference location={entry.origen} /> → <LocationReference location={entry.destino} /></>;
  return <>{entry.origen ? "−" : "+"}{quantity} {entry.producto} · ajuste en <LocationReference location={entry.origen ?? entry.destino} /></>;
}

export function MovementHistory({ entries }: { entries: HistoryEntry[] }) {
  return <div className="history-list">{entries.map(entry => {
    const Icon = ICONS[entry.tipo];
    const adjustmentNegative = entry.tipo === "ajuste" && !!entry.origen;
    return <article className="history-card" key={entry.id} data-movement-id={entry.id}>
      <span className="history-icon"><Icon size={21} aria-hidden="true" /></span>
      <div className="history-copy">
        <span className={`history-type ${entry.tipo}${adjustmentNegative ? " ajuste-negative" : ""}`}>{entry.tipo === "entrada" ? "Entrada" : entry.tipo === "retiro" ? "Retiro" : entry.tipo === "traslado" ? "Traslado" : "Ajuste"}</span>
        <p><strong>{movementText(entry)}</strong></p>
      </div>
      <time className="history-date" dateTime={entry.fecha}>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(entry.fecha))}</time>
    </article>;
  })}</div>;
}
