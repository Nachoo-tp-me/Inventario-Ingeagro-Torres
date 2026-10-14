import Link from "next/link";
import { PageHeading } from "@/components/dashboard";
import { LocationNavigation } from "@/components/location-navigation";
import { ShelfGrid } from "@/components/shelf-grid";
import type { ShelfSummary } from "@/lib/shelf-model";

export function ShelfOverview({ shelves }: { shelves: ShelfSummary[] }) {
  return <div className="page-stack">
    <LocationNavigation />
    <PageHeading eyebrow="UBICACIONES" title="Estantes" description="Las cajas se muestran de frente, en su posición física permanente." />
    {!shelves.length && <div className="empty-state"><h2>No hay estantes para mostrar</h2><p>Los estantes estarán disponibles cuando se registren sus ubicaciones.</p></div>}
    {(["A", "B"] as const).map(group => {
      const members = shelves.filter(shelf => shelf.grupo === group);
      return members.length ? <section key={group} className="shelf-group" aria-labelledby={`shelf-group-${group}`}>
        <h2 id={`shelf-group-${group}`}>Grupo {group}</h2>
        <div className="shelves-grid">{members.map(shelf => <article key={shelf.id} className="shelf-card">
          <h3><Link href={`/estantes/${shelf.id}`}>{shelf.nombre}</Link></h3>
          <ShelfGrid shelf={shelf} />
        </article>)}</div>
      </section> : null;
    })}
  </div>;
}
