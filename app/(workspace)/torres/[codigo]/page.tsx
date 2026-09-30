import Link from "next/link";
import { ArrowLeft, Layers3 } from "lucide-react";
import { notFound } from "next/navigation";
import { getDashboardSummary } from "@/lib/inventory";

export default async function TowerDetailPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const data = await getDashboardSummary();
  const tower = data.torres.find(
    (item) => item.codigo === codigo.toUpperCase(),
  );
  if (!tower) notFound();
  return (
    <div className="page-stack">
      <Link className="back-link" href="/torres">
        <ArrowLeft size={18} aria-hidden="true" /> Todas las torres
      </Link>
      <div className="detail-heading">
        <span className="detail-icon">
          <Layers3 size={28} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">TORRE FÍSICA</p>
          <h1>{tower.codigo}</h1>
          <p>{tower.total} compartimientos en total</p>
        </div>
      </div>
      <div className="detail-stats">
        <div>
          <span className="availability-dot" />
          {tower.disponibles} disponibles
        </div>
        <div>
          <span className="occupancy-dot" />
          {tower.ocupados} ocupados
        </div>
      </div>
      <div className="coming-panel">
        <span className="coming-mark">
          <Layers3 size={27} aria-hidden="true" />
        </span>
        <h2>Vista de compartimientos próximamente</h2>
        <p>
          El modelo visual de los pisos y compartimientos se incorporará en el
          siguiente bloque.
        </p>
      </div>
    </div>
  );
}
