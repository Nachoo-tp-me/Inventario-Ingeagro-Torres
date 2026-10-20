import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { historyLocationParts, type HistoryEntry, type HistoryLocation } from "@/lib/history-model";
import { searchLocationHref } from "@/lib/location-search-model";
import { physicalLocationContext } from "@/lib/stock-model";

const ICONS = { entrada: ArrowDownLeft, retiro: ArrowUpRight, traslado: ArrowLeftRight, ajuste: SlidersHorizontal };
const TYPE_LABELS = { entrada: "Entrada", retiro: "Retiro", traslado: "Traslado", ajuste: "Ajuste" };
const DATE_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" });

// The code at the time of the movement is the main text; the current code (when it differs) is a secondary note.
// The link keeps the full label as its accessible name and the permanent location id behind its href.
function LocationReference({ location }: { location: HistoryLocation | null }) {
  if (!location) return <>—</>;
  const { code, note } = historyLocationParts(location);
  const content = <><span className="history-code">{code}</span>{note && <> <span className="history-note">({note})</span></>}</>;
  return location.ubicacionActual
    ? <Link className="text-link history-location-link" href={searchLocationHref(location.ubicacionActual)} title={physicalLocationContext(location.ubicacionActual)}>{content}</Link>
    : <span className="history-location">{content}</span>;
}

function Place({ label, location }: { label: string; location: HistoryLocation | null }) {
  return <div><dt>{label}</dt><dd><LocationReference location={location} /></dd></div>;
}

function places(entry: HistoryEntry) {
  if (entry.tipo === "entrada") return <Place label="Hacia" location={entry.destino} />;
  if (entry.tipo === "retiro") return <Place label="Desde" location={entry.origen} />;
  if (entry.tipo === "traslado") return <><Place label="Desde" location={entry.origen} /><Place label="Hacia" location={entry.destino} /></>;
  return <Place label="En" location={entry.origen ?? entry.destino} />;
}

function signedQuantity(entry: HistoryEntry) {
  const quantity = entry.cantidad.toLocaleString("es-CL");
  if (entry.tipo === "entrada") return `+${quantity}`;
  if (entry.tipo === "retiro") return `−${quantity}`;
  if (entry.tipo === "traslado") return quantity;
  return `${entry.origen ? "−" : "+"}${quantity}`;
}

export function MovementHistory({ entries }: { entries: HistoryEntry[] }) {
  return <ul className="history-list">{entries.map(entry => {
    const Icon = ICONS[entry.tipo];
    const adjustmentNegative = entry.tipo === "ajuste" && !!entry.origen;
    return <li className="history-card" key={entry.id} data-movement-id={entry.id}>
      <div className="history-head">
        <span className={`history-type ${entry.tipo}${adjustmentNegative ? " ajuste-negative" : ""}`}><Icon size={18} aria-hidden="true" />{TYPE_LABELS[entry.tipo]}</span>
        <time className="history-date" dateTime={entry.fecha}>{DATE_FORMAT.format(new Date(entry.fecha))}</time>
      </div>
      <div className="history-main">
        <strong className="history-product">{entry.producto}</strong>
        <span className="history-quantity">{signedQuantity(entry)}<span className="history-sr"> unidades</span></span>
      </div>
      <dl className="history-places">{places(entry)}</dl>
    </li>;
  })}</ul>;
}
