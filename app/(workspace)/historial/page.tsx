import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Clock3, SlidersHorizontal } from "lucide-react";
import { PageHeading } from "@/components/dashboard";
import { getHistory, type HistoryEntry } from "@/lib/stock-data";

const ICONS = {
  entrada: ArrowDownLeft,
  retiro: ArrowUpRight,
  traslado: ArrowLeftRight,
  ajuste: SlidersHorizontal,
};

function movementText(entry: HistoryEntry) {
  const quantity = entry.cantidad.toLocaleString("es-CL");
  if (entry.tipo === "entrada") return `+${quantity} ${entry.producto} → ${entry.destino}`;
  if (entry.tipo === "retiro") return `−${quantity} ${entry.producto} ← ${entry.origen}`;
  if (entry.tipo === "traslado") return `${quantity} ${entry.producto} · ${entry.origen} → ${entry.destino}`;
  return `${entry.origen ? "−" : "+"}${quantity} ${entry.producto} · ajuste en ${entry.origen ?? entry.destino}`;
}

export default async function HistoryPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { pagina } = await searchParams;
  const parsedPage = Number(pagina ?? "1");
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 100000
    ? parsedPage : 1;
  const { entries, hasNext } = await getHistory(page);
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="ACTIVIDAD"
        title="Historial"
        description="Cada entrada, retiro, traslado y ajuste registrado en el inventario."
      />
      {entries.length === 0 ? (
        <div className="catalog-empty"><Clock3 size={34} aria-hidden="true" /><h2>{page === 1 ? "Aún no hay movimientos" : "No hay más movimientos"}</h2><p>Las operaciones de stock aparecerán aquí en orden cronológico.</p></div>
      ) : <div className="history-list">
        {entries.map((entry) => {
          const Icon = ICONS[entry.tipo];
          const adjustmentNegative = entry.tipo === "ajuste" && !!entry.origen;
          return <article className="history-card" key={entry.id}>
            <span className="history-icon"><Icon size={21} aria-hidden="true" /></span>
            <div className="history-copy">
              <span className={`history-type ${entry.tipo}${adjustmentNegative ? " ajuste-negative" : ""}`}>{entry.tipo === "entrada" ? "Entrada" : entry.tipo === "retiro" ? "Retiro" : entry.tipo === "traslado" ? "Traslado" : "Ajuste"}</span>
              <p><strong>{movementText(entry)}</strong></p>
            </div>
            <time className="history-date" dateTime={entry.fecha}>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(entry.fecha))}</time>
          </article>;
        })}
      </div>}
      {(page > 1 || hasNext) && <nav className="history-pagination" aria-label="Páginas de historial">
        {page > 1 ? <Link className="catalog-button" href={page === 2 ? "/historial" : `/historial?pagina=${page - 1}`}>Anterior</Link> : <span />}
        <span>Página {page}</span>
        {hasNext ? <Link className="catalog-button" href={`/historial?pagina=${page + 1}`}>Siguiente</Link> : <span />}
      </nav>}
    </div>
  );
}
