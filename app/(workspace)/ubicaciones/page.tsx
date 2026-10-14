import Link from "next/link";
import { PageHeading } from "@/components/dashboard";

export default function LocationsPage() {
  return <div className="page-stack">
    <PageHeading eyebrow="INVENTARIO" title="Ubicaciones" description="Selecciona el tipo de almacenamiento que quieres consultar." />
    <div className="locations-grid">
      <Link href="/torres" className="tower-card"><h2>Torres</h2><p className="page-description">Compartimientos de las torres.</p></Link>
      <Link href="/estantes" className="tower-card"><h2>Estantes</h2><p className="page-description">Cajas de los grupos A y B.</p></Link>
    </div>
  </div>;
}
