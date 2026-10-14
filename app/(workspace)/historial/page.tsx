import Link from "next/link";
import { Clock3 } from "lucide-react";
import { PageHeading } from "@/components/dashboard";
import { getHistory } from "@/lib/stock-data";
import { MovementHistory } from "@/components/movement-history";

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
      ) : <MovementHistory entries={entries} />}
      {(page > 1 || hasNext) && <nav className="history-pagination" aria-label="Páginas de historial">
        {page > 1 ? <Link className="catalog-button" href={page === 2 ? "/historial" : `/historial?pagina=${page - 1}`}>Anterior</Link> : <span />}
        <span>Página {page}</span>
        {hasNext ? <Link className="catalog-button" href={`/historial?pagina=${page + 1}`}>Siguiente</Link> : <span />}
      </nav>}
    </div>
  );
}
