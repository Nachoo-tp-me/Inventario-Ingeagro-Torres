import Link from "next/link";
import { PageHeading } from "@/components/dashboard";
import { LocationNavigation } from "@/components/location-navigation";
import { ShelfGrid, SHELF_STATUS_HELP } from "@/components/shelf-grid";
import type { ShelfSummary } from "@/lib/shelf-model";

export function ShelfOverview({ shelves }: { shelves: ShelfSummary[] }) {
  const description = `${shelves.length} ${shelves.length === 1 ? "estante independiente" : "estantes independientes"} · vista frontal`;
  return <div className="page-stack">
    <LocationNavigation />
    <PageHeading eyebrow="UBICACIONES" title="Estantes" description={description} />
    {!shelves.length && <div className="empty-state"><h2>No hay estantes para mostrar</h2><p>Los estantes estarán disponibles cuando se registren sus ubicaciones.</p></div>}
    {shelves.length > 0 && <p className="shelf-status-help">{SHELF_STATUS_HELP}</p>}
    {(["A", "B"] as const).map(group => {
      const members = shelves.filter(shelf => shelf.grupo === group);
      return members.length ? <section key={group} className="shelf-group" aria-labelledby={`shelf-group-${group}`}>
        <div className="shelf-group-header">
          <h2 id={`shelf-group-${group}`}>Grupo {group}</h2>
          <span>{members.length} {members.length === 1 ? "estante" : "estantes"}</span>
        </div>
        <div className="shelves-grid">{members.map(shelf => <article key={shelf.id} className="shelf-card">
          <div className="shelf-card-header">
            <h3><Link href={`/estantes/${shelf.id}`}>{shelf.nombre}</Link></h3>
            <span>{shelf.cajas.length} {shelf.cajas.length === 1 ? "caja" : "cajas"}</span>
          </div>
          <ShelfGrid shelf={shelf} />
        </article>)}</div>
      </section> : null;
    })}
  </div>;
}
