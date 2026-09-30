import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Layers3,
  Package,
  Warehouse,
} from "lucide-react";
import type { DashboardSummary, TowerSummary } from "@/lib/inventory";

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Boxes;
  tone?: "red" | "green";
}) {
  return (
    <div className={`metric-card ${tone ?? ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
      <strong>{value.toLocaleString("es-CL")}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function Metrics({ data }: { data: DashboardSummary }) {
  return (
    <section className="metrics-grid" aria-label="Resumen de inventario">
      <MetricCard
        label="Compartimientos"
        value={data.total}
        detail="Capacidad física total"
        icon={Layers3}
      />
      <MetricCard
        label="Ocupados"
        value={data.ocupados}
        detail="Con stock disponible"
        icon={Boxes}
        tone="red"
      />
      <MetricCard
        label="Disponibles"
        value={data.disponibles}
        detail="Sin productos activos"
        icon={Warehouse}
        tone="green"
      />
      <MetricCard
        label="Productos"
        value={data.productos}
        detail="Referencias distintas"
        icon={Package}
      />
    </section>
  );
}

export function TowerCard({ tower }: { tower: TowerSummary }) {
  const percent = tower.total
    ? Math.round((tower.ocupados / tower.total) * 100)
    : 0;
  return (
    <Link href={`/torres/${tower.codigo}`} className="tower-card">
      <div className="tower-card-top">
        <span className="tower-symbol">
          <Layers3 size={24} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <ArrowUpRight size={19} aria-hidden="true" className="tower-arrow" />
      </div>
      <span className="tower-kicker">TORRE FÍSICA</span>
      <h3>{tower.codigo}</h3>
      <div className="tower-ratio">
        <strong>{tower.ocupados}</strong>
        <span> / {tower.total} ocupados</span>
      </div>
      <div
        className="occupancy-track"
        role="img"
        aria-label={`${tower.ocupados} de ${tower.total} compartimientos ocupados`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="tower-card-foot">
        <span className="availability-dot" />
        {tower.disponibles} disponibles{" "}
        <ArrowRight size={17} aria-hidden="true" />
      </div>
    </Link>
  );
}

export function TowerGrid({ towers }: { towers: TowerSummary[] }) {
  if (towers.length === 0) {
    return (
      <div className="empty-state">
        <Layers3 size={30} aria-hidden="true" />
        <h3>No hay torres para mostrar</h3>
        <p>Comprueba los datos de Supabase o el acceso de esta cuenta.</p>
      </div>
    );
  }
  return (
    <div className="tower-grid">
      {towers.map((tower) => (
        <TowerCard key={tower.id} tower={tower} />
      ))}
    </div>
  );
}
